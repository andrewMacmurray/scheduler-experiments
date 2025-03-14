/** TYPES */

type Tag =
  | "SUCCEED"
  | "FAIL"
  | "AND_THEN"
  | "ON_ERROR"
  | "BINDING"
  | "RECIEVE"

export interface Process {
  id: number
  root: Task
  stack: Stack | null
  mailbox: any[]
}

interface Stack {
  tag: Tag
  callback: (a: any) => Task
  rest: Stack | null
}

export interface Task {
  tag: Tag
  value?: any
  task?: Task
  callback?: (a: any) => any
  kill?: Cleanup
}

type Cleanup = () => void

/** Public API */

export function succeed(val: any): Task {
  return {
    tag: "SUCCEED",
    value: val,
  }
}

export function fail(val: any): Task {
  return {
    tag: "FAIL",
    value: val,
  }
}

export function andThen(task: Task, callback: (val: any) => Task): Task {
  return {
    tag: "AND_THEN",
    task: task,
    callback: callback,
  }
}

export function onError(task: Task, callback: (val: any) => Task): Task {
  return {
    tag: "ON_ERROR",
    task: task,
    callback: callback,
  }
}

export function binding(callback: (cb: (val: Task) => void) => Cleanup): Task {
  return {
    tag: "BINDING",
    callback: callback,
  }
}

export function recieve(callback: (val: any) => Task): Task {
  return {
    tag: "RECIEVE",
    callback: callback,
  }
}

export function map2(
  f: (a: any, b: any) => any,
  taskA: Task,
  taskB: Task,
): Task {
  return andThen(taskA, (a) => andThen(taskB, (b) => succeed(f(a, b))))
}

/** Run a Process */

let guid: number = 0

function newProcess(task: Task): Process {
  const proc = {
    id: guid,
    root: task,
    stack: null,
    mailbox: [],
  }
  guid++
  return proc
}

export function startTask(task: Task) {
  _Scheduler_step(newProcess(task))
}

function _Scheduler_step(proc: Process) {
  while (proc.root) {
    var rootTag = proc.root.tag
    if (rootTag === "SUCCEED" || rootTag === "FAIL") {
      // This is effectively the "fail everything if there's an error" bit
      // e.g. If there's a chain of successes in the stack but the root tag is "FAIL" skip them until you get to "FAIL"
      while (proc.stack && proc.stack.tag !== rootTag) {
        proc.stack = proc.stack.rest
      }
      // We're fully done with the process so bail out
      if (!proc.stack) {
        return
      }
      // This is the callback set during the "AND_THEN" / "ON_ERROR" step (effectively the second argument of `Task.andThen` or `Task.onError`)
      // Returns another "Task" object (either more work todo or a "SUCCEED" / "FAIL")
      // Within an app when a "Task" is done this is the value gets passed to one more call to "BINDING" via `_Platform_sendToApp`
      proc.root = proc.stack.callback(proc.root.value)
      // We're done with this bit of the stack so pop it to the next bit
      proc.stack = proc.stack.rest
    } else if (rootTag === "BINDING") {
      // Actually do the effectful thing - this is where the current step finishes
      // A scheduler binding returns a cleanup function, so if `kill` is called from the outside the running task gets cleaned up
      proc.root.kill = proc.root.callback!(function(newRoot) {
        // When the effect is done this callback gets invoked with a new task (most often a "SUCCEED" / "FAIL")
        // This return value becomes the next "thing to do"
        proc.root = newRoot
        // This starts the next step
        _Scheduler_step(proc)
      })
      return
    } else if (rootTag === "RECIEVE") {
      if (proc.mailbox.length === 0) {
        return
      }
      // Any values that have been sent to the process are hoovered up one by one here
      proc.root = proc.root.callback!(proc.mailbox.shift())
    } // if (rootTag === "AND_THEN" || rootTag === "ON_ERROR") {
    else {
      // I find the semantics here a bit confusing
      // This step adds the "AND_THEN" or "ON_ERROR" callback to the stack
      //   "SUCCEED" if "AND_THEN"
      //   "FAIL"    if "ON_ERROR"
      // I kind of think of this as "When you reach the next SUCCESS or FAILURE step, do this"
      // We put the first task of "Task.andThen" as the root which will be processed in the next loop
      proc.stack = {
        tag: rootTag === "AND_THEN" ? "SUCCEED" : "FAIL",
        callback: proc.root.callback!,
        rest: proc.stack,
      }
      proc.root = proc.root.task!
    }
  }
}
