import { waitForPortFree as defaultWaitForPortFree } from "./network.mjs"

export async function stopOwnedChild(child, port, dependencies = {}) {
  const signalOwnedProcess = dependencies.signalOwnedProcess ?? signalOwnedProcessGroup
  const waitForPortFree = dependencies.waitForPortFree ?? defaultWaitForPortFree
  const waitForProcessGroupGone =
    dependencies.waitForProcessGroupGone ?? defaultWaitForProcessGroupGone
  if (!child || child.exitCode !== null) {
    await waitForPortFree(port)
    await waitForProcessGroupGone(child?.pid)
    return { exitCode: child?.exitCode ?? 0, signal: "none" }
  }

  const closed = onceClosed(child)
  if (child.killed !== true && (child.signalCode === null || child.signalCode === undefined)) {
    signalOwnedProcess(child, "SIGTERM")
  }
  const result = dependencies.delay
    ? await Promise.race([closed, dependencies.delay(10_000).then(() => null)])
    : await waitForClose(closed, 10_000)
  if (result) {
    await waitForPortFree(port)
    await waitForProcessGroupGone(child.pid)
    return result
  }

  signalOwnedProcess(child, "SIGKILL")
  const killed = await closed
  await waitForPortFree(port)
  await waitForProcessGroupGone(child.pid)
  return killed
}

async function defaultWaitForProcessGroupGone(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      process.kill(-pid, 0)
    } catch (error) {
      if (error?.code === "ESRCH") return
      throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error("Owned Next process group was not released")
}

function waitForClose(closed, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    closed.then((result) => {
      clearTimeout(timer)
      resolve(result)
    })
  })
}

export function signalOwnedProcessGroup(child, signal) {
  if (Number.isInteger(child.pid) && child.pid > 0) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch (error) {
      if (error?.code !== "ESRCH") throw error
    }
  }
  child.kill(signal)
}

function onceClosed(child) {
  return new Promise((resolve) => {
    child.once("close", (exitCode, signal) => resolve({ exitCode: exitCode ?? 0, signal }))
  })
}
