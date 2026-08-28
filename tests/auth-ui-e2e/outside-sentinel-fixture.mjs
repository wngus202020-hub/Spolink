import { lstat, mkdtemp, readdir, readFile, realpath, rm, rmdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const fixtureState = new WeakMap()
const sentinelBytes = Buffer.from("outside-sentinel\n")

export async function withOutsideSentinelFixture(label, callback) {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(label)) throw new Error("Outside fixture label is invalid")
  if (typeof callback !== "function") throw new Error("Outside fixture callback is required")
  const parent = await realpath(os.tmpdir())
  const outside = await realpath(await mkdtemp(path.join(parent, `spolink-outside-${label}-`)))
  const sentinel = path.join(outside, "sentinel")
  await writeFile(sentinel, sentinelBytes, { mode: 0o600 })
  const rootIdentity = await readOwnedIdentity(outside, "directory", 0o700)
  const sentinelIdentity = await readOwnedIdentity(sentinel, "file", 0o600)
  const fixture = Object.freeze({
    expected: {
      bytes: Buffer.from(sentinelBytes),
      dev: sentinelIdentity.dev,
      ino: sentinelIdentity.ino,
    },
    outside,
    sentinel,
  })
  fixtureState.set(fixture, { parent, rootIdentity, sentinelIdentity })
  try {
    return await callback(fixture)
  } finally {
    await removeOutsideFixture(fixture)
  }
}

async function removeOutsideFixture(fixture) {
  const state = fixtureState.get(fixture)
  if (!state) throw new Error("Outside fixture handle is unregistered")
  const rootIdentity = await readOwnedIdentity(fixture.outside, "directory", 0o700)
  assertIdentity(rootIdentity, state.rootIdentity, "Outside fixture root")
  if (
    path.dirname(fixture.outside) !== state.parent ||
    (await realpath(fixture.outside)) !== fixture.outside
  ) {
    throw new Error("Outside fixture ancestry changed")
  }
  const entries = await readdir(fixture.outside)
  if (entries.length !== 1 || entries[0] !== "sentinel") {
    throw new Error("Outside fixture inventory changed")
  }
  const sentinelIdentity = await readOwnedIdentity(fixture.sentinel, "file", 0o600)
  assertIdentity(sentinelIdentity, state.sentinelIdentity, "Outside fixture sentinel")
  if (sentinelIdentity.nlink !== 1 || !(await readFile(fixture.sentinel)).equals(sentinelBytes)) {
    throw new Error("Outside fixture sentinel changed")
  }
  await rm(fixture.sentinel)
  const finalRoot = await readOwnedIdentity(fixture.outside, "directory", 0o700)
  assertIdentity(finalRoot, state.rootIdentity, "Outside fixture root")
  if ((await readdir(fixture.outside)).length !== 0) {
    throw new Error("Outside fixture gained entries during cleanup")
  }
  await rmdir(fixture.outside)
  fixtureState.delete(fixture)
}

async function readOwnedIdentity(candidate, expectedType, expectedMode) {
  const stats = await lstat(candidate)
  if (
    stats.isSymbolicLink() ||
    !stats[expectedType === "file" ? "isFile" : "isDirectory"]() ||
    stats.uid !== process.getuid() ||
    (stats.mode & 0o777) !== expectedMode
  ) {
    throw new Error(`Outside fixture ${expectedType} ownership changed`)
  }
  return { dev: stats.dev, ino: stats.ino, nlink: stats.nlink }
}

function assertIdentity(current, expected, label) {
  if (current.dev !== expected.dev || current.ino !== expected.ino) {
    throw new Error(`${label} identity changed`)
  }
}
