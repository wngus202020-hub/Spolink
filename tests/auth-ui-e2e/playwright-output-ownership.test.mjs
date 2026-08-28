import assert from "node:assert/strict"
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { withOutsideSentinelFixture } from "./outside-sentinel-fixture.mjs"
import { prepareRawPlaywrightOutputDir } from "./raw-output.mjs"

const expectedEntries = [
  { kind: "last-run", name: ".last-run.json" },
  {
    kind: "diagnosis",
    name: "task-3-browser-desktop-chromium.json",
    project: "desktop-chromium",
  },
  {
    kind: "diagnosis",
    name: "task-3-browser-mobile-chromium.json",
    project: "mobile-chromium",
  },
]

test("default Playwright output owns the exact entries created after directory replacement", async () => {
  const output = await prepareRawPlaywrightOutputDir({ expectedEntries })
  assert.equal(output.retained, false)
  let cleaned = false
  try {
    await replaceWithExpectedPlaywrightOutput(output.dir)
    const cleanup = await output.cleanup()
    cleaned = true
    assert.deepEqual(cleanup, {
      validatedEntries: expectedEntries.map((entry) => entry.name).sort(),
    })
    await assert.rejects(() => access(output.dir), /ENOENT/u)
  } finally {
    if (!cleaned) await cleanupFailedOutput(output)
  }
})

test("default Playwright output cleanup accepts private creator modes", async () => {
  const output = await prepareRawPlaywrightOutputDir({ expectedEntries })
  let cleaned = false
  try {
    await replaceWithExpectedPlaywrightOutput(output.dir, {
      directoryMode: 0o700,
      lastRunMode: 0o600,
    })
    await output.cleanup()
    cleaned = true
  } finally {
    if (!cleaned) await cleanupFailedOutput(output)
  }
})

test("default Playwright output cleanup survives two clean creator-mode replacements", async () => {
  // Given: two independent owned output roots, as used by consecutive focused runner invocations.
  for (let run = 0; run < 2; run += 1) {
    const output = await prepareRawPlaywrightOutputDir()
    let cleaned = false
    try {
      // When: Playwright replaces the prepared output directory using its creator-default mode.
      await rm(output.dir, { recursive: true })
      await mkdir(output.dir, { mode: 0o755 })
      await chmod(output.dir, 0o755)
      await writeFile(path.join(output.dir, ".last-run.json"), "{}\n", { mode: 0o644 })

      // Then: owned cleanup accepts the runner-created replacement and removes the whole root.
      await output.cleanup()
      cleaned = true
      await assert.rejects(() => access(output.dir), /ENOENT/u)
    } finally {
      if (!cleaned) await cleanupFailedOutput(output)
    }
  }
})

for (const attack of ["file", "directory"]) {
  test(`default Playwright output rejects an unregistered ${attack} before deletion`, async () => {
    await withOutsideSentinelFixture(
      `playwright-output-${attack}`,
      async ({ expected, sentinel }) => {
        const output = await prepareRawPlaywrightOutputDir({ expectedEntries })
        const unexpected = path.join(
          output.dir,
          attack === "file" ? "unexpected.txt" : "unexpected",
        )
        try {
          await replaceWithExpectedPlaywrightOutput(output.dir)
          if (attack === "file")
            await writeFile(unexpected, "unexpected-payload\n", { mode: 0o600 })
          else {
            await mkdir(unexpected, { mode: 0o700 })
            await writeFile(path.join(unexpected, "payload"), "nested-payload\n", { mode: 0o600 })
          }
          const snapshots = await snapshotPaths([
            path.join(output.dir, ".last-run.json"),
            path.join(output.dir, "task-3-browser-desktop-chromium.json"),
            unexpected,
            sentinel,
          ])

          await assert.rejects(() => output.cleanup(), /unregistered|inventory|topology/iu)
          await assertSnapshotsUnchanged(snapshots)
          assert.equal((await readFile(sentinel)).equals(expected.bytes), true)
        } finally {
          await rm(unexpected, { force: true, recursive: true })
          await cleanupFailedOutput(output)
        }
      },
    )
  })
}

test("external Playwright output remains caller-owned", async () => {
  const external = await mkdtemp(path.join(os.tmpdir(), "spolink-output-external-"))
  await chmod(external, 0o700)
  try {
    const output = await prepareRawPlaywrightOutputDir({
      expectedEntries,
      suppliedDir: external,
    })
    assert.equal(output.retained, true)
    const payload = path.join(external, "caller-owned")
    await writeFile(payload, "preserved\n", { mode: 0o600 })
    await output.cleanup()
    assert.equal(await readFile(payload, "utf8"), "preserved\n")
  } finally {
    await rm(external, { force: true, recursive: true })
  }
})

async function replaceWithExpectedPlaywrightOutput(
  directory,
  { directoryMode = 0o755, lastRunMode = 0o644 } = {},
) {
  await rm(directory, { force: true, recursive: true })
  await mkdir(directory, { mode: directoryMode })
  await writeFile(
    path.join(directory, ".last-run.json"),
    `${JSON.stringify({ failedTests: [], status: "passed" })}\n`,
    { mode: lastRunMode },
  )
  for (const project of ["desktop-chromium", "mobile-chromium"]) {
    await writeFile(
      path.join(directory, `task-3-browser-${project}.json`),
      `${JSON.stringify(validDiagnosis(project))}\n`,
      { mode: 0o600 },
    )
  }
}

function validDiagnosis(project) {
  const names = [
    "3 Auth sessions",
    "cleanup/seed",
    "learner activation",
    "/mypage document request/response",
    "SSR profile/read model/heading",
    "nav/filter/detail",
    "cleanup",
  ]
  return {
    document: { finished: true, status: 200 },
    event: "task3-browser-diagnosis",
    headingMatched: true,
    inflightPath: null,
    lastFailedPath: null,
    phases: names.map((name, index) => ({ durationMs: index + 1, name, status: "passed" })),
    profileMatched: true,
    project,
  }
}

async function cleanupFailedOutput(output) {
  try {
    await output.cleanup()
  } catch (error) {
    if (!/nested entry identity|unregistered/iu.test(String(error))) throw error
    await rm(output.dir, { force: true, recursive: true })
    await mkdir(output.dir, { mode: 0o700 })
    await output.cleanup()
  }
}

async function snapshotPaths(paths) {
  return Promise.all(
    paths.map(async (candidate) => {
      const metadata = await lstat(candidate)
      return {
        bytes: metadata.isFile() ? await readFile(candidate) : null,
        candidate,
        dev: metadata.dev,
        ino: metadata.ino,
      }
    }),
  )
}

async function assertSnapshotsUnchanged(snapshots) {
  for (const snapshot of snapshots) {
    const metadata = await stat(snapshot.candidate)
    assert.equal(metadata.dev, snapshot.dev)
    assert.equal(metadata.ino, snapshot.ino)
    if (snapshot.bytes)
      assert.equal((await readFile(snapshot.candidate)).equals(snapshot.bytes), true)
  }
}
