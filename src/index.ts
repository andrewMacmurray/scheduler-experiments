import * as S from "./scheduler.ts"

/** Effectful tasks */

const sleep = (ms: number): S.Task =>
  S.binding((done) => {
    const id = setTimeout(() => done(S.succeed(ms)), ms)

    // Abort
    return () => {
      console.log("Clearing..")
      clearTimeout(id)
    }
  })

const consoleLog = (msg: any): S.Task =>
  S.binding((done) => {
    console.log("LOG", msg)
    done(S.succeed({}))

    // No Abort
    return () => {}
  })

/** Helpers */

const logResult = (task: S.Task): S.Task => {
  console.time("task")
  return S.onError(
    S.andThen(task, (msg) => {
      console.timeEnd("task")
      return consoleLog(msg)
    }),
    (msg) => {
      console.timeEnd("task")
      return consoleLog(msg)
    }
  )
}

const runTask = (task: S.Task): void => {
  S.startTask(logResult(task))
}

/** Combine and run */

const add2 = (a, b) => a + b

const sleepyAdd = S.map2(add2, sleep(1005), sleep(1000))
const doubleSleepyAdd = S.map2(add2, sleepyAdd, sleepyAdd)

const batched = S.batch(Array.from({ length: 100000 }, (_, i) => sleep(100)))

runTask(batched)
