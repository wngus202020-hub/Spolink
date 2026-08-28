import { readFile } from "node:fs/promises"
import { isReleased } from "./qa-files.mjs"

export async function waitForQaRelease(metadataPath, seconds) {
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"))
  const deadline = Date.now() + seconds * 1000
  while (Date.now() <= deadline) {
    if (await isReleased(metadata.releasePath)) return
    await delay(250)
  }
  throw new Error("QA hold timed out after 120 seconds")
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
