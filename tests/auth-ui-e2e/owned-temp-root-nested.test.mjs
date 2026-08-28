import assert from "node:assert/strict"
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { withOutsideSentinelFixture } from "./outside-sentinel-fixture.mjs"
import { createOwnedTempRoot } from "./owned-temp-root.mjs"

for (const attack of ["directory", "regular-file"]) {
  test(`unregistered nested ${attack} fails before recursive deletion`, () =>
    withAttackFixture(`nested-${attack}`, async (fixture) => {
      const target = await fixture.owner.createDirectory("recursive-target")
      const nested = path.join(target.path, `unexpected-${attack}`)
      const payload = attack === "directory" ? path.join(nested, "payload") : nested
      if (attack === "directory") await mkdir(nested, { mode: 0o700 })
      await writeFile(payload, `nested-${attack}-payload\n`, { mode: 0o600 })
      const expected = {
        payload: await fileSnapshot(payload),
        sentinel: await fileSnapshot(fixture.sentinel),
        target: await pathIdentity(target.path),
      }
      try {
        const rejected = await fixture.owner.remove(target).then(
          () => false,
          () => true,
        )
        assert.deepEqual(
          {
            payload: await optionalSnapshot(() => fileSnapshot(payload)),
            rejected,
            sentinel: await fileSnapshot(fixture.sentinel),
            target: await optionalSnapshot(() => pathIdentity(target.path)),
          },
          { ...expected, rejected: true },
        )
      } finally {
        if (await optionalSnapshot(() => pathIdentity(target.path))) {
          await rm(nested, { recursive: attack === "directory" })
          await fixture.owner.remove(target)
        }
        await fixture.owner.cleanup()
      }
    }))
}

function withAttackFixture(label, callback) {
  return withOutsideSentinelFixture(label, async (outsideFixture) =>
    callback({
      ...outsideFixture,
      owner: await createOwnedTempRoot({ prefix: `spolink-owned-${label}-` }),
    }),
  )
}

async function pathIdentity(filePath) {
  const stats = await lstat(filePath)
  return { dev: stats.dev, ino: stats.ino, mode: stats.mode, nlink: stats.nlink }
}

async function fileSnapshot(filePath) {
  return { ...(await pathIdentity(filePath)), bytes: await readFile(filePath) }
}

async function optionalSnapshot(read) {
  try {
    return await read()
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}
