import assert from "node:assert/strict"
import { access, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { createFakeLifecycleRepo, spawnBuffered, waitForFile } from "./fake-lifecycle-harness.mjs"

test("fake lifecycle repo removes its partial root when setup fails", async () => {
  let unexpectedFixture
  const expectedRoot = path.join(os.tmpdir(), "missing-spolink-auth-source-config.toml")
  const before = await matchingRoots("spolink-auth-fake-partial-")
  try {
    await assert.rejects(async () => {
      unexpectedFixture = await createFakeLifecycleRepo("spolink-auth-fake-partial-", {
        sourceConfigPath: expectedRoot,
      })
    }, /ENOENT/u)
    await assert.rejects(() => access(expectedRoot), /ENOENT/u)
    assert.deepEqual(await matchingRoots("spolink-auth-fake-partial-"), before)
  } finally {
    await unexpectedFixture?.cleanup()
  }
})

test("concurrent fake lifecycle processes clean only their exact-owned auth lock namespace", async () => {
  // Given: two independent processes holding fake lifecycle auth locks concurrently.
  const coordinationRoot = await mkdtemp(path.join(os.tmpdir(), "spolink-fake-lock-processes-"))
  const harnessUrl = new URL("./fake-lifecycle-harness.mjs", import.meta.url).href
  const childSource = `
    import { access, writeFile } from "node:fs/promises"
    import { createFakeLifecycleRepo, waitForFile } from ${JSON.stringify(harnessUrl)}
    const [prefix, metadataPath, releasePath] = process.argv.slice(1)
    const fixture = await createFakeLifecycleRepo(prefix)
    try {
      const lock = await fixture.createAuthLock()
      await writeFile(
        metadataPath,
        JSON.stringify({ authLockPath: fixture.authLockPath, repoRoot: fixture.repoRoot }),
        { mode: 0o600 },
      )
      await waitForFile(releasePath, 10_000)
      await lock.cleanup()
      await lock.cleanup()
      await access(fixture.repoRoot)
    } finally {
      await fixture.cleanup()
      await fixture.cleanup()
    }
  `
  const children = ["left", "right"].map((name) => {
    const metadataPath = path.join(coordinationRoot, `${name}.json`)
    const releasePath = path.join(coordinationRoot, `${name}.release`)
    return {
      metadataPath,
      releasePath,
      run: spawnBuffered(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          childSource,
          `spolink-${name}-`,
          metadataPath,
          releasePath,
        ],
        { timeoutMs: 15_000 },
      ),
    }
  })

  try {
    try {
      await Promise.all(children.map(({ metadataPath }) => waitForFile(metadataPath, 5_000)))
    } catch (error) {
      const results = await Promise.all(children.map(({ run }) => run.result))
      throw new Error(
        `${error.message}\n${results
          .map(({ stderr }) => stderr.trim())
          .filter(Boolean)
          .join("\n")}`,
      )
    }
    const [left, right] = await Promise.all(
      children.map(async ({ metadataPath }) => JSON.parse(await readFile(metadataPath, "utf8"))),
    )

    // When: the left process releases and cleans its exact-owned namespace first.
    assert.notEqual(left.authLockPath, right.authLockPath)
    assert.equal(left.authLockPath.startsWith(left.repoRoot), true)
    assert.equal(right.authLockPath.startsWith(right.repoRoot), true)
    await writeFile(children[0].releasePath, "release\n", { mode: 0o600 })
    const leftResult = await children[0].run.result

    // Then: left exits cleanly while the right process still owns an intact lock.
    assert.equal(leftResult.exitCode, 0, leftResult.stderr)
    await access(right.authLockPath)
    await writeFile(children[1].releasePath, "release\n", { mode: 0o600 })
    const rightResult = await children[1].run.result
    assert.equal(rightResult.exitCode, 0, rightResult.stderr)
  } finally {
    for (const child of children) {
      await writeFile(child.releasePath, "release\n", { mode: 0o600 })
      await child.run.result
    }
    await rm(coordinationRoot, { force: true, recursive: true })
  }
})

async function matchingRoots(prefix) {
  return (await readdir(os.tmpdir())).filter((name) => name.startsWith(prefix)).sort()
}
