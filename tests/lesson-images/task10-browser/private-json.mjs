import { writeFile } from "node:fs/promises"
import path from "node:path"

export function createPrivateJsonWriter(evidenceDir) {
  return async (name, value) => {
    await writeFile(path.join(evidenceDir, name), `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
    })
  }
}

export function redactProcessOutput(value) {
  return value
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/giu, "<id>")
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/gu, "<jwt>")
    .replace(/[\w.+-]+@[\w.-]+/gu, "<email>")
}
