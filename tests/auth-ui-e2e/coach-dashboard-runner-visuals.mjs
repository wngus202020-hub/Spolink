import { chmod, readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

import { sha256 } from "./process.mjs"

export async function collectBasicCoachDashboardVisuals(directory, expectedCount) {
  let names = []
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith(".png")).sort()
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
  const files = []
  for (const name of names) {
    const filePath = path.join(directory, name)
    await chmod(filePath, 0o600)
    const metadata = await stat(filePath)
    if (!metadata.isFile() || metadata.size === 0) throw new Error("Invalid dashboard PNG")
    files.push({ bytes: metadata.size, name, sha256: sha256(await readFile(filePath)) })
  }
  return { files, verdict: files.length === expectedCount ? "APPROVE" : "REJECT" }
}
