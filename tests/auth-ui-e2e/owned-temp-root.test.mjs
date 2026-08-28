import assert from "node:assert/strict"
import {
  access,
  chmod,
  link,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { withOutsideSentinelFixture } from "./outside-sentinel-fixture.mjs"
import { createOwnedTempRoot } from "./owned-temp-root.mjs"

test("owned temp root removes only a registered child and preserves outside identity", () =>
  withAttackFixture("success", async (fixture) => {
    const child = await fixture.owner.createDirectory("payload")
    await writeFile(path.join(child.path, "nested"), "owned\n")
    await fixture.owner.sealDirectory(child)
    await fixture.owner.remove(child)
    await assert.rejects(() => access(child.path), /ENOENT/u)
    const file = await fixture.owner.createFile("payload-file", "owned\n")
    await fixture.owner.remove(file)
    await assert.rejects(() => access(file.path), /ENOENT/u)
    await assertSentinelUnchanged(fixture)
    await fixture.owner.cleanup()
  }))

test("registration attacks preserve one outside sentinel byte and inode", () =>
  withAttackFixture("registration", async (fixture) => {
    const candidates = [
      ["traversal", path.join(fixture.owner.root, "nested", "..", "..", "escape")],
      ["absolute external", path.join(fixture.outside, "external")],
      ["sibling", `${fixture.owner.root}-sibling`],
      ["root", fixture.owner.root],
    ]
    for (const [label, candidate] of candidates) {
      await assert.rejects(() => fixture.owner.register(candidate), /owned temp child/u, label)
      await assertSentinelUnchanged(fixture)
    }
    const child = await fixture.owner.createDirectory("duplicate")
    await assert.rejects(() => fixture.owner.register(child.path), /registered/u)
    await assertSentinelUnchanged(fixture)
    await assert.rejects(() => fixture.owner.remove(child.path), /handle/u)
    await assertSentinelUnchanged(fixture)
    await fixture.owner.remove(child)
    await assert.rejects(() => fixture.owner.remove(child), /registered/u)
    await assertSentinelUnchanged(fixture)
    await fixture.owner.cleanup()
  }))

test("symlink swap fails closed and preserves outside sentinel byte and inode", () =>
  withAttackFixture("symlink", async (fixture) => {
    const child = await fixture.owner.createDirectory("payload")
    await rename(child.path, `${child.path}.moved`)
    await symlink(fixture.outside, child.path)
    try {
      await assert.rejects(() => fixture.owner.remove(child), /symlink|identity|topology/u)
      await assertSentinelUnchanged(fixture)
    } finally {
      await rm(child.path, { force: true })
      await rm(`${child.path}.moved`, { recursive: true })
      await fixture.owner.abandon(child)
      await fixture.owner.cleanup()
    }
  }))

test("mode, external file hardlink, and root swap preserve outside sentinel identity", async () => {
  for (const attack of ["mode", "external-hardlink", "root-swap"]) {
    await withAttackFixture(attack, async (fixture) => {
      const child = await fixture.owner.createFile("payload", "owned\n")
      const outsideAlias = path.join(fixture.outside, "owned-file-alias")
      try {
        if (attack === "mode") await chmod(child.path, 0o700)
        // Directory hardlinks are unavailable on supported filesystems; this crosses the root with
        // a regular-file hardlink and proves the child nlink invariant independently of root nlink.
        if (attack === "external-hardlink") await link(child.path, outsideAlias)
        if (attack === "root-swap") {
          await rename(fixture.owner.root, `${fixture.owner.root}.moved`)
          await symlink(`${fixture.owner.root}.moved`, fixture.owner.root)
        }
        await assert.rejects(() => fixture.owner.remove(child), /mode|link|root|symlink|identity/u)
        await assertSentinelUnchanged(fixture)
      } finally {
        if (attack === "root-swap") {
          await rm(fixture.owner.root, { force: true })
          await rename(`${fixture.owner.root}.moved`, fixture.owner.root)
        }
        await rm(outsideAlias, { force: true })
        await chmod(child.path, 0o600).catch(() => {})
        await rm(child.path, { force: true })
        await fixture.owner.abandon(child)
        await fixture.owner.cleanup()
      }
    })
  }
})

test("unregistered root directory topology fails before recursive child deletion", () =>
  withAttackFixture("root-topology", async (fixture) => {
    const child = await fixture.owner.createDirectory("payload")
    const unregistered = path.join(fixture.owner.root, "unregistered-directory")
    await mkdir(unregistered, { mode: 0o700 })
    try {
      await assert.rejects(() => fixture.owner.remove(child), /root.*link|topology/iu)
      await access(child.path)
      await assertSentinelUnchanged(fixture)
    } finally {
      await rm(unregistered, { recursive: true })
      await rm(child.path, { force: true, recursive: true })
      await fixture.owner.abandon(child).catch((error) => {
        if (!/not registered/u.test(error.message)) throw error
      })
      await fixture.owner.cleanup()
    }
  }))

test("unregistered regular file inventory fails before recursive deletion", () =>
  withAttackFixture("regular-inventory", async (fixture) => {
    const target = await fixture.owner.createDirectory("recursive-target")
    const trackedFile = await fixture.owner.createFile("tracked-file", "unexpected-preserved\n")
    const unexpectedFile = path.join(fixture.owner.root, "unexpected-file")
    await rename(trackedFile.path, unexpectedFile)
    const unexpectedStats = await lstat(unexpectedFile)
    const unexpectedBytes = await readFile(unexpectedFile)
    let targetSurvived = false
    try {
      await assert.rejects(() => fixture.owner.remove(target), /unregistered topology/u)
      const currentUnexpected = await lstat(unexpectedFile)
      assert.equal(currentUnexpected.dev, unexpectedStats.dev)
      assert.equal(currentUnexpected.ino, unexpectedStats.ino)
      assert.deepEqual(await readFile(unexpectedFile), unexpectedBytes)
      await assertSentinelUnchanged(fixture)
      await access(target.path)
      targetSurvived = true
    } finally {
      if (targetSurvived) {
        await rename(unexpectedFile, trackedFile.path)
        await fixture.owner.remove(target)
        await fixture.owner.remove(trackedFile)
        await fixture.owner.cleanup()
      } else {
        await rm(fixture.owner.root, { force: true, recursive: true })
      }
    }
  }))

function withAttackFixture(label, callback) {
  return withOutsideSentinelFixture(label, async (outsideFixture) =>
    callback({
      ...outsideFixture,
      owner: await createOwnedTempRoot({ prefix: `spolink-owned-${label}-` }),
    }),
  )
}

async function assertSentinelUnchanged(fixture) {
  const stats = await lstat(fixture.sentinel)
  assert.equal(stats.isFile(), true)
  assert.equal(stats.isSymbolicLink(), false)
  assert.equal(stats.dev, fixture.expected.dev)
  assert.equal(stats.ino, fixture.expected.ino)
  assert.deepEqual(await readFile(fixture.sentinel), fixture.expected.bytes)
}
