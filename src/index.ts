import * as S from "./scheduler.ts";

const sleep = (ms: number): S.Task =>
  S.binding((done) => {
    // Do timeout
    const id = setTimeout(() => done(S.succeed(ms)), ms);

    // Abort
    return () => clearTimeout(id);
  });

const consoleLog = (msg: any): S.Task =>
  S.binding((done) => {
    // Do console log and return
    console.log("INFO", msg);
    done(S.succeed(null));

    // No Abort
    return () => {};
  });

const add2 = (a, b) => a + b;

const sleepyAdd = S.map2(add2, sleep(1005), sleep(1000));
const doubleSleepyAdd = S.map2(add2, sleepyAdd, sleepyAdd);

S.startTask(S.andThen(doubleSleepyAdd, consoleLog));
