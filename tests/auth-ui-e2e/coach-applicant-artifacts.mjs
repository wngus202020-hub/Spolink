import { chmod, lstat, readdir } from "node:fs/promises"
import path from "node:path"

async function hardenEntry(entryPath) {
  let entry
  try {
    entry = await lstat(entryPath)
  } catch (error) {
    if (error?.code === "ENOENT") return
    throw error
  }

  if (entry.isSymbolicLink()) {
    throw new Error(`Coach applicant artifact path contains symlink: ${entryPath}`)
  }

  if (entry.isDirectory()) {
    await chmod(entryPath, 0o700)
    const names = (await readdir(entryPath)).sort()
    for (const name of names) {
      await hardenEntry(path.join(entryPath, name))
    }
    return
  }

  if (entry.isFile()) await chmod(entryPath, 0o600)
}

export async function hardenCoachApplicantArtifactRoots(roots) {
  for (const root of roots) {
    await hardenEntry(path.resolve(root))
  }
}
