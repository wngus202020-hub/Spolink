import { createHash } from "node:crypto"
import { chmod, lstat, readdir, readFile, realpath, writeFile } from "node:fs/promises"
import path from "node:path"

import { Task3EvidenceError } from "./task3-evidence-validation.mjs"

export async function assertTask3PrivateTree(root) {
  const expectedUid = process.getuid?.()
  async function walk(entryPath) {
    const stats = await lstat(entryPath)
    if (stats.isSymbolicLink()) throw new Task3EvidenceError("Task 3 evidence contains a symlink")
    if (expectedUid !== undefined && stats.uid !== expectedUid)
      throw new Task3EvidenceError("Task 3 evidence has a foreign owner")
    if (stats.isDirectory()) {
      if ((stats.mode & 0o777) !== 0o700)
        throw new Task3EvidenceError("Task 3 evidence directory must be mode 0700")
      for (const name of await readdir(entryPath)) await walk(path.join(entryPath, name))
      return
    }
    if (!stats.isFile() || stats.nlink !== 1 || (stats.mode & 0o777) !== 0o600)
      throw new Task3EvidenceError("Task 3 evidence file must be private and singly linked")
  }
  await walk(root)
  if ((await realpath(root)) !== path.resolve(root))
    throw new Task3EvidenceError("Task 3 evidence root must not traverse symlinks")
}

export async function snapshotTask3PrivateTree(root) {
  await assertTask3PrivateTree(root)
  const values = []
  async function walk(directory) {
    for (const name of await readdir(directory)) {
      const absolute = path.join(directory, name)
      const stats = await lstat(absolute)
      if (stats.isDirectory()) await walk(absolute)
      else
        values.push([
          path.relative(root, absolute),
          createHash("sha256")
            .update(await readFile(absolute))
            .digest("hex"),
        ])
    }
  }
  await walk(root)
  return values.sort(([left], [right]) => left.localeCompare(right))
}

export async function writeTask3PrivateJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await chmod(filePath, 0o600)
}
