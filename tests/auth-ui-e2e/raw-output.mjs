import { chmod, lstat, mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export async function prepareRawPlaywrightOutputDir({
  prefix = "spolink-auth-playwright-",
  retain = false,
  suppliedDir = null,
} = {}) {
  const dir = suppliedDir ?? (await mkdtemp(path.join(os.tmpdir(), prefix)))
  await chmod(dir, 0o700)
  const stats = await lstat(dir)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("Raw Playwright output target must be a real directory.")
  }
  if ((stats.mode & 0o777) !== 0o700) {
    throw new Error("Raw Playwright output target must be mode 0700.")
  }
  const realDir = await realpath(dir)
  const evidenceRoot = path.resolve(".omo/evidence")
  if (realDir === evidenceRoot || realDir.startsWith(`${evidenceRoot}${path.sep}`)) {
    throw new Error("Raw Playwright output target must be outside .omo/evidence.")
  }
  return {
    dir: realDir,
    cleanup: async () => {
      if (!retain) await rm(realDir, { force: true, recursive: true })
    },
    retained: retain,
  }
}
