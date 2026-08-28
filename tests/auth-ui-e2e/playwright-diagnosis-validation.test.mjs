import assert from "node:assert/strict"
import { lstat, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

import { prepareRawPlaywrightOutputDir } from "./raw-output.mjs"

const projects = ["desktop-chromium", "mobile-chromium"]
const expectedEntries = [
  { kind: "last-run", name: ".last-run.json" },
  ...projects.map((project) => ({
    kind: "diagnosis",
    name: `task-3-browser-${project}.json`,
    project,
  })),
]

test("actual desktop and mobile diagnosis fixtures pass complete validation", async () => {
  const output = await prepareRawPlaywrightOutputDir({ expectedEntries })
  let cleaned = false
  try {
    await writeValidOutput(output.dir)
    await output.cleanup()
    cleaned = true
  } finally {
    if (!cleaned) await discardOwnedOutput(output)
  }
})

const attacks = [
  ["project-only", (value) => ({ project: value.project })],
  ["missing field", ({ headingMatched: _removed, ...value }) => value],
  ["wrong type", (value) => ({ ...value, document: { ...value.document, status: "200" } })],
  [
    "failed verdict",
    (value) => ({
      ...value,
      phases: value.phases.map((phase, index) =>
        index === 5 ? { ...phase, status: "failed" } : phase,
      ),
    }),
  ],
  ["extra raw field", (value) => ({ ...value, authorization: "raw-secret-marker" })],
]

for (const [label, mutate] of attacks) {
  test(`malformed diagnosis rejects ${label} before deleting any output`, async () => {
    const output = await prepareRawPlaywrightOutputDir({ expectedEntries })
    let cleanupResolved = false
    try {
      await writeValidOutput(output.dir)
      const diagnosisPath = path.join(output.dir, "task-3-browser-desktop-chromium.json")
      const malformed = mutate(actualDiagnosis("desktop-chromium"))
      await writeFile(diagnosisPath, `${JSON.stringify(malformed, null, 2)}\n`, { mode: 0o600 })
      const snapshots = await snapshotOutput(output.dir)
      const cleanup = output.cleanup().then((value) => {
        cleanupResolved = true
        return value
      })

      await assert.rejects(cleanup, /diagnosis/iu)
      await assertSnapshotsUnchanged(snapshots)
    } finally {
      if (!cleanupResolved) await discardOwnedOutput(output)
    }
  })
}

async function writeValidOutput(directory) {
  await mkdir(directory, { mode: 0o755 })
  await writeFile(
    path.join(directory, ".last-run.json"),
    `${JSON.stringify({ failedTests: [], status: "passed" })}\n`,
    { mode: 0o644 },
  )
  for (const project of projects) {
    await writeFile(
      path.join(directory, `task-3-browser-${project}.json`),
      `${JSON.stringify(actualDiagnosis(project), null, 2)}\n`,
      { mode: 0o600 },
    )
  }
}

function actualDiagnosis(project) {
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

async function snapshotOutput(directory) {
  return Promise.all(
    [".last-run.json", ...projects.map((project) => `task-3-browser-${project}.json`)].map(
      async (name) => {
        const candidate = path.join(directory, name)
        const metadata = await lstat(candidate)
        return { bytes: await readFile(candidate), candidate, dev: metadata.dev, ino: metadata.ino }
      },
    ),
  )
}

async function assertSnapshotsUnchanged(snapshots) {
  for (const snapshot of snapshots) {
    const metadata = await stat(snapshot.candidate)
    assert.equal(metadata.dev, snapshot.dev)
    assert.equal(metadata.ino, snapshot.ino)
    assert.equal((await readFile(snapshot.candidate)).equals(snapshot.bytes), true)
  }
}

async function discardOwnedOutput(output) {
  await rm(output.dir, { force: true, recursive: true })
  await output.cleanup()
}
