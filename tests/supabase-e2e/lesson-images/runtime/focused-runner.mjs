export function createFocusedRunner(dependencies) {
  let activeChild = null
  let receivedSignal = null

  return {
    receiveSignal(signal) {
      receivedSignal = signal
      activeChild?.kill(signal)
    },
    async run({ holdMs, label }) {
      let ownedRuntime = false
      let suiteResult = null
      let cleanupError = null
      try {
        try {
          await dependencies.readStatus()
          dependencies.reportWorking?.(
            "reusing the valid guarded local Supabase runtime without reset or stop",
          )
        } catch (error) {
          if (error?.code !== "supabase_not_running") throw error
          ownedRuntime = true
          dependencies.reportWorking?.(
            "starting and resetting a fresh task-owned guarded local Supabase runtime",
          )
          await dependencies.start()
          await dependencies.reset()
        }

        dependencies.reportWorking?.(`running focused lesson-image live suite (${label})`)
        if (holdMs > 0) await interruptibleDelay(holdMs, () => receivedSignal !== null)
        suiteResult = receivedSignal
          ? interruptedResult(receivedSignal)
          : await dependencies.runSuite(label, {
              onClose(child) {
                if (activeChild === child) activeChild = null
              },
              onSpawn(child) {
                activeChild = child
              },
            })
      } catch (error) {
        suiteResult = {
          exitCode: 1,
          signal: null,
          stderr: error instanceof Error ? error.message : "Focused runner error",
          stdout: "",
        }
      } finally {
        if (ownedRuntime) {
          try {
            await dependencies.stop()
            await dependencies.assertStopped()
          } catch (error) {
            cleanupError = error
          }
        }
      }

      const exitCode = cleanupError
        ? 1
        : receivedSignal
          ? signalExitCode(receivedSignal)
          : suiteResult.exitCode
      return { ...suiteResult, cleanupError, exitCode }
    },
  }
}

function interruptibleDelay(ms, interrupted) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      clearInterval(poll)
      resolve()
    }, ms)
    const poll = setInterval(() => {
      if (!interrupted()) return
      clearInterval(poll)
      clearTimeout(timer)
      resolve()
    }, 25)
  })
}

function interruptedResult(signal) {
  return { exitCode: signalExitCode(signal), signal, stderr: "", stdout: "" }
}

function signalExitCode(signal) {
  return signal === "SIGINT" ? 130 : 143
}
