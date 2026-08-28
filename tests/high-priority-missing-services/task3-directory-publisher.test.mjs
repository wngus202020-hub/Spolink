import assert from "node:assert/strict"
import { constants } from "node:fs"
import { mkdtemp, open, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import { publishTask3Anchored } from "./task3-directory-publisher.mjs"
import { Task3EvidenceError } from "./task3-evidence.mjs"

const sentinel = Buffer.from('{"status":"sentinel"}\n')
const replacement = Buffer.from('{"status":"replacement"}\n')

test("publisher reports typed launch failure and attaches fallback cleanup failure", async () => {
  await withPublicationDirectory(async (fixture) => {
    const cleanupFailure = new Error("controlled fallback cleanup failure")
    const buildRoots = []
    await assert.rejects(
      publishTask3Anchored(fixture.options, {
        makeBuildRoot: recordingBuildRoot(buildRoots),
        processPath: "/missing/task3-process",
        remove: async (root) => {
          await removeBuildRoot(root)
          throw cleanupFailure
        },
      }),
      (error) => {
        assertTask3Error(error, "TASK3_PUBLICATION_PROCESS_FAILED", "ENOENT")
        assert.equal(error.causes.cleanup, cleanupFailure)
        return true
      },
    )
    await assertUnchanged(fixture, buildRoots)
  })
})

test("publisher rejects injected self-temp cleanup failure before attempt or canonical commit", async () => {
  for (const publication of ["attempt", "canonical"])
    await withPublicationDirectory(async (fixture) => {
      const buildRoots = []
      await assert.rejects(
        publishTask3Anchored(fixture.options, {
          failureMode: "precommit-cleanup",
          makeBuildRoot: recordingBuildRoot(buildRoots),
        }),
        (error) => {
          assertTask3Error(error, "TASK3_PUBLICATION_CLEANUP_FAILED", "ENOENT")
          return true
        },
      )
      await assertUnchanged(fixture, buildRoots)
    }, publication)
})

test("publisher preserves publication failure and attaches failed-temp cleanup cause", async () => {
  await withPublicationDirectory(async (fixture) => {
    await writeFile(path.join(fixture.root, fixture.outputName), sentinel, { mode: 0o600 })
    await assert.rejects(
      publishTask3Anchored(fixture.options, {
        failureMode: "publication-cleanup",
      }),
      (error) => {
        assertTask3Error(error, "TASK3_PUBLICATION_PROCESS_FAILED", "EEXIST")
        assert.equal(error.causes.cleanup?.code, "ENOENT")
        assert.equal(error.causes.rollback, undefined)
        return true
      },
    )
    assert.deepEqual(await readFile(path.join(fixture.root, fixture.outputName)), sentinel)
    assert.deepEqual(await readdir(fixture.root), [fixture.outputName])
  })
})

test("publisher reports typed native nonzero without replacing an exclusive output", async () => {
  await withPublicationDirectory(async (fixture) => {
    await writeFile(path.join(fixture.root, fixture.outputName), sentinel, { mode: 0o600 })
    await assert.rejects(publishTask3Anchored(fixture.options), (error) => {
      assertTask3Error(error, "TASK3_PUBLICATION_PROCESS_FAILED", "EEXIST")
      assert.equal(error.causes.cleanup, undefined)
      return true
    })
    assert.deepEqual(await readFile(path.join(fixture.root, fixture.outputName)), sentinel)
    assert.deepEqual(await readdir(fixture.root), [fixture.outputName])
  })
})

async function withPublicationDirectory(run, publication = "attempt") {
  const root = await mkdtemp(path.join(tmpdir(), "task3-publication-test-"))
  const directoryHandle = await open(
    root,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  )
  const outputName = "result.json"
  if (publication === "canonical")
    await writeFile(path.join(root, outputName), sentinel, { mode: 0o600 })
  try {
    await run({
      options: { body: replacement, directoryHandle, outputName, publication },
      outputName,
      publication,
      root,
    })
  } finally {
    await directoryHandle.close()
    await rm(root, { force: true, recursive: true })
  }
}

async function assertUnchanged(fixture, buildRoots) {
  if (fixture.publication === "attempt") {
    await assert.rejects(readFile(path.join(fixture.root, fixture.outputName)), { code: "ENOENT" })
    assert.deepEqual(await readdir(fixture.root), [])
  } else {
    assert.deepEqual(await readFile(path.join(fixture.root, fixture.outputName)), sentinel)
    assert.deepEqual(await readdir(fixture.root), [fixture.outputName])
  }
  for (const root of buildRoots) await assert.rejects(readdir(root), { code: "ENOENT" })
}

function assertTask3Error(error, code, causeCode) {
  assert.equal(error instanceof Task3EvidenceError, true)
  assert.equal(error.code, code)
  assert.equal(error.cause?.code, causeCode)
}

function recordingBuildRoot(buildRoots) {
  return async () => {
    const root = await mkdtemp(path.join(tmpdir(), "task3-publisher-red-"))
    buildRoots.push(root)
    return root
  }
}

function removeBuildRoot(root) {
  return rm(root, { force: true, recursive: true })
}
