import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { chmod, lstat, mkdir, realpath } from "node:fs/promises"
import path from "node:path"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"

import { createOwnedTempRoot } from "./owned-temp-root.mjs"
import {
  removeValidatedPlaywrightOutput,
  validateExpectedPlaywrightEntries,
} from "./playwright-output-inventory.mjs"

const outputTailBytes = 4_096

export async function createBoundedChildOutputCapture({
  rawDir = null,
  retainRawOutput = false,
} = {}) {
  const rawOutput = await prepareRawPlaywrightOutputDir({
    prefix: "spolink-next-output-",
    retain: retainRawOutput,
    suppliedDir: rawDir,
  })
  const stdout = createOutputCollector(path.join(rawOutput.dir, "next-stdout.log"))
  const stderr = createOutputCollector(path.join(rawOutput.dir, "next-stderr.log"))
  let pipelines = null
  let finalSummary = null

  return {
    rawDir: rawOutput.dir,
    attach(child) {
      if (pipelines) throw new Error("Next output capture is already attached.")
      if (!child.stdout || !child.stderr) throw new Error("Next output streams must be piped.")
      pipelines = [
        pipeline(child.stdout, stdout.transform, stdout.destination),
        pipeline(child.stderr, stderr.transform, stderr.destination),
      ]
    },
    async cleanup() {
      await this.settle()
      await rawOutput.cleanup()
    },
    async settle() {
      if (!pipelines) throw new Error("Next output capture was not attached.")
      if (!finalSummary) {
        await Promise.all(pipelines)
        finalSummary = { stderr: stderr.summary(), stdout: stdout.summary() }
      }
      return finalSummary
    },
  }
}

export async function prepareRawPlaywrightOutputDir({
  expectedEntries = null,
  prefix = "spolink-auth-playwright-",
  retain = false,
  suppliedDir = null,
} = {}) {
  const owner = suppliedDir ? null : await createOwnedTempRoot({ prefix })
  const ownedWorkspace = owner ? await owner.createDirectory("workspace") : null
  const ownedOutput = ownedWorkspace ? path.join(ownedWorkspace.path, "output") : null
  const expected = expectedEntries ? validateExpectedPlaywrightEntries(expectedEntries) : null
  if (ownedOutput && !expected) await mkdir(ownedOutput, { mode: 0o700 })
  const dir = suppliedDir ?? ownedOutput
  if (suppliedDir || !expected) {
    await chmod(dir, 0o700)
    const stats = await lstat(dir)
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error("Raw Playwright output target must be a real directory.")
    }
    if ((stats.mode & 0o777) !== 0o700) {
      throw new Error("Raw Playwright output target must be mode 0700.")
    }
  }
  if (owner && !expected) await owner.sealDirectory(ownedWorkspace)
  const realDir =
    expected && owner
      ? path.join(await realpath(ownedWorkspace.path), "output")
      : await realpath(dir)
  const evidenceRoot = path.resolve(".omo/evidence")
  if (realDir === evidenceRoot || realDir.startsWith(`${evidenceRoot}${path.sep}`)) {
    throw new Error("Raw Playwright output target must be outside .omo/evidence.")
  }
  return {
    dir: realDir,
    cleanup: async () => {
      if (!retain && owner) {
        const validation = expected
          ? await removeValidatedPlaywrightOutput({ directory: realDir, expected })
          : null
        if (!expected) await restoreOwnedOutputDirectoryMode(realDir)
        await owner.remove(ownedWorkspace)
        await owner.cleanup()
        return validation
      }
      return null
    },
    retained: retain || suppliedDir !== null,
  }
}

async function restoreOwnedOutputDirectoryMode(directory) {
  const stats = await lstat(directory)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("Raw Playwright output target identity changed before cleanup.")
  }
  await chmod(directory, 0o700)
}

function createOutputCollector(filePath) {
  const hash = createHash("sha256")
  let bytes = 0
  let tail = Buffer.alloc(0)
  return {
    destination: createWriteStream(filePath, { flags: "wx", mode: 0o600 }),
    summary() {
      return {
        bytes,
        sha256: hash.digest("hex"),
        tail: redactOutputTail(tail.toString("utf8")),
      }
    },
    transform: new Transform({
      transform(chunk, _encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytes += buffer.length
        hash.update(buffer)
        tail = Buffer.concat([tail, buffer]).subarray(-outputTailBytes)
        callback(null, buffer)
      },
    }),
  }
}

function redactOutputTail(value) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[REDACTED_EMAIL]")
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu,
      "[REDACTED_ID]",
    )
    .replace(/(?:postgres(?:ql)?):\/\/[^\s]+/giu, "[REDACTED_DB_URL]")
    .replace(/(?:Bearer\s+|eyJ)[A-Za-z0-9._-]+/gu, "[REDACTED_TOKEN]")
    .replace(/(authorization|cookie|password|set-cookie|token)\s*[:=]\s*[^\s]+/giu, "$1=[REDACTED]")
    .replace(/(?:sb_(?:publishable|secret)_[A-Za-z0-9_-]+)/gu, "[REDACTED_KEY]")
    .replace(/01[016789]-?\d{3,4}-?\d{4}/gu, "[REDACTED_PHONE]")
    .replace(/(?:\/private)?\/var\/folders\/[^\s]+|\/tmp\/[^\s]+/gu, "[REDACTED_TEMP_PATH]")
}
