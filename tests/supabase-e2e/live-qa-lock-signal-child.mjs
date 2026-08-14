import { setTimeout } from "node:timers/promises"

import { acquireLiveQaLock } from "./live-qa-lock.mjs"

const lockDir = process.env.SPOLINK_SIGNAL_LOCK_DIR
if (!lockDir) throw new Error("SPOLINK_SIGNAL_LOCK_DIR is required")

await acquireLiveQaLock("signal-child", { lockDir })
process.stdout.write("ready\n")

while (true) {
  await setTimeout(1_000)
}
