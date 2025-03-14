/** TYPES */

type Tag = "SUCCEED" | "FAIL" | "AND_THEN" | "ON_ERROR" | "FORK" | "BINDING" | "RECIEVE";

export interface Process {
  id: number;
  root: Task;
  stack: Stack | null;
  mailbox: any[];
}

// Task types

interface Succeed {
  tag: "SUCCEED";
  value: any;
}

interface Fail {
  tag: "FAIL";
  value: any;
}

interface AndThen {
  tag: "AND_THEN";
  task: Task;
  callback: (val: any) => Task;
}

interface OnError {
  tag: "ON_ERROR";
  task: Task;
  callback: (val: any) => Task;
}

interface Fork {
  tag: "FORK";
  procA: Process;
  procB: Process;
  callback: (a: any, b: any) => any;
}

interface Recieve {
  tag: "RECIEVE";
  callback: (val: any) => Task;
}

type Cleanup = () => void;

interface Binding {
  tag: "BINDING";
  callback: (onComplete: (val: Task) => void) => Cleanup;
  kill?: Cleanup;
}

export type Task = Succeed | Fail | AndThen | OnError | Fork | Recieve | Binding;

interface Stack {
  tag: Tag;
  callback: (a: any) => Task;
  rest: Stack | null;
}

/** Public API */

export function succeed(val: any): Task {
  return {
    tag: "SUCCEED",
    value: val,
  };
}

export function fail(val: any): Task {
  return {
    tag: "FAIL",
    value: val,
  };
}

export function andThen(task: Task, callback: (val: any) => Task): Task {
  return {
    tag: "AND_THEN",
    task: task,
    callback: callback,
  };
}

export function onError(task: Task, callback: (val: any) => Task): Task {
  return {
    tag: "ON_ERROR",
    task: task,
    callback: callback,
  };
}

export function binding(callback: (cb: (val: Task) => void) => Cleanup): Task {
  return {
    tag: "BINDING",
    callback: callback,
  };
}

export function recieve(callback: (val: any) => Task): Task {
  return {
    tag: "RECIEVE",
    callback: callback,
  };
}

export function map2(f: (a: any, b: any) => any, taskA: Task, taskB: Task): Task {
  const procA = newProcess(taskA);
  const procB = newProcess(taskB);
  return {
    tag: "FORK",
    procA: procA,
    procB: procB,
    callback: f,
  };
}

/** Run a Process */

let guid: number = 0;

function newProcess(task: Task): Process {
  const proc = {
    id: guid,
    root: task,
    stack: null,
    mailbox: [],
  };
  guid++;
  return proc;
}

export function startTask(task: Task) {
  _Scheduler_step(newProcess(task));
}

// Options
// Stay on the low level path and implement map2 manually
// Switch to promises

function _Scheduler_step(proc: Process) {
  while (proc.root) {
    switch (proc.root.tag) {
      case "SUCCEED":
      case "FAIL":
        // This is effectively the "fail everything if there's an error" bit
        // e.g. If there's a chain of successes in the stack but the root tag is "FAIL" skip them until you get to "FAIL"
        while (proc.stack && proc.stack.tag !== proc.root.tag) {
          proc.stack = proc.stack.rest;
        }
        // We're fully done with the process so bail out
        if (!proc.stack) {
          return;
        }
        // This is the callback set during the "AND_THEN" / "ON_ERROR" step (effectively the second argument of `Task.andThen` or `Task.onError`)
        // Returns another "Task" object (either more work todo or a "SUCCEED" / "FAIL")
        // Within an app when a "Task" is done this is the value gets passed to one more call to "BINDING" via `_Platform_sendToApp`
        proc.root = proc.stack.callback(proc.root.value);
        // We're done with this bit of the stack so pop it to the next bit
        proc.stack = proc.stack.rest;
        break;
      case "BINDING":
        // Actually do the effectful thing - this is where the current step finishes
        // A scheduler binding returns a cleanup function, so if `kill` is called from the outside the running task gets cleaned up
        proc.root.kill = proc.root.callback!(function (newRoot: Task) {
          // When the effect is done this callback gets invoked with a new task (most often a "SUCCEED" / "FAIL")
          // This return value becomes the next "thing to do"
          proc.root = newRoot;
          // This starts the next step
          _Scheduler_step(proc);
        });
        return;
      case "RECIEVE":
        if (proc.mailbox.length === 0) {
          return;
        }
        // Any values that have been sent to the process are hoovered up one by one here
        proc.root = proc.root.callback!(proc.mailbox.shift());
        break;
      case "FORK":
        // Forking a process into 2..
        const join_results = proc.root.callback;
        let rA = null;
        let rB = null;

        // Modify subprocess A to check on subprocess B and either:
        // - re-start the parent process with a combined result
        // - save the intermediate result and wait for subprocess B to finish
        // TODO: handle failure
        proc.root.procA.mailbox = proc.mailbox;
        proc.root.procA.root = andThen(proc.root.procA.root, (resA) => {
          return binding(() => {
            if (rB) {
              // If process B result has already come back create a `succeed` task with the combined results
              // Restart the parent process with the combined result
              proc.root = succeed(join_results(resA, rB));
              _Scheduler_step(proc);
            } else {
              rA = resA;
            }
            // TODO: can the child processes be cleaned up?
            return () => {};
          });
        });

        // Modify subprocess B to check on subprocess A and either:
        // - re-start the parent process with a combined result
        // - save the intermediate result and wait for subprocess A to finish
        // TODO: handle failure
        proc.root.procB.mailbox = proc.mailbox;
        proc.root.procB.root = andThen(proc.root.procB.root, (resB) => {
          return binding(() => {
            if (rA) {
              // If process A result has already come back create a `succeed` task with the combined results
              // Restart the parent process with the combined result
              proc.root = succeed(join_results(rA, resB));
              _Scheduler_step(proc);
            } else {
              rB = resB;
            }
            // TODO: can the child processes be cleaned up?
            return () => {};
          });
        });

        // step through both subprocesses
        _Scheduler_step(proc.root.procA);
        _Scheduler_step(proc.root.procB);

        // Bail out until the above are done
        return;
      case "AND_THEN":
      case "ON_ERROR":
        // I find the semantics here a bit confusing
        // This step adds the "AND_THEN" or "ON_ERROR" callback to the stack
        //   "SUCCEED" if "AND_THEN"
        //   "FAIL"    if "ON_ERROR"
        // I kind of think of this as "When you reach the next SUCCESS or FAILURE step, do this"
        // We put the first task of "Task.andThen" as the root which will be processed in the next loop
        proc.stack = {
          tag: proc.root.tag === "AND_THEN" ? "SUCCEED" : "FAIL",
          callback: proc.root.callback!,
          rest: proc.stack,
        };
        proc.root = proc.root.task!;
        break;
    }
  }
}
