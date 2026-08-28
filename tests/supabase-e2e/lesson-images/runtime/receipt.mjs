import { writeFile } from "node:fs/promises"
import path from "node:path"

const EVIDENCE_DIR = ".omo/evidence/lesson-image-upload/task-9"

export async function writeRuntimeReceipt(runId, value) {
  await writeFile(
    path.join(EVIDENCE_DIR, `${runId}-runtime-receipt.json`),
    `${JSON.stringify(value, null, 2)}\n`,
    { mode: 0o600 },
  )
}
