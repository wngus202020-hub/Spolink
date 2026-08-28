import { spawn as defaultSpawn } from "node:child_process"

const TARGET = "tests/supabase-e2e/lesson-images.test.mjs"
const TIMEOUT_MS = 15 * 60 * 1000

export function runExactLessonImageTest(runLabel, hooks = {}, overrides = {}) {
  const dependencies = {
    clearTimeout,
    cwd: process.cwd(),
    env: process.env,
    execPath: process.execPath,
    setTimeout,
    spawn: defaultSpawn,
    ...overrides,
  }
  return new Promise((resolve) => {
    const child = dependencies.spawn(dependencies.execPath, ["--test", TARGET], {
      cwd: dependencies.cwd,
      env: {
        ...dependencies.env,
        SPOLINK_TASK9_RUN_ID: runLabel,
        SPOLINK_TASK9_RUN_LABEL: runLabel,
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    })
    hooks.onSpawn?.(child)
    let stdout = ""
    let stderr = ""
    const timer = dependencies.setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS)
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.once("close", (exitCode, signal) => {
      dependencies.clearTimeout(timer)
      hooks.onClose?.(child)
      resolve({ exitCode: exitCode ?? 1, signal, stderr, stdout })
    })
  })
}
