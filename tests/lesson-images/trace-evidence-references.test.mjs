import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  auditTraceHashReferences,
  refreshTraceHashReferences,
} from "./trace-evidence-references.mjs"

test("refreshes duplicate and copied trace hashes by intended archive path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "spolink-trace-reference-test-"))
  try {
    const attempt = path.join(root, "task-10", "attempt")
    const archives = [
      "run-1/authoring/task-7-lesson-image-upload.zip",
      "run-1/public/public-gallery-trace.zip",
      "run-2/authoring/task-7-lesson-image-upload.zip",
      "run-2/public/public-gallery-trace.zip",
      "task-10-authoring-trace.zip",
    ].map((relative) => path.join(attempt, relative))
    for (const archive of archives) {
      await mkdir(path.dirname(archive), { recursive: true })
      await writeFile(archive, "duplicate-before")
    }
    const oldHash = sha256("duplicate-before")
    await writeJson(path.join(attempt, "run-1/authoring/browser-qa.json"), {
      traceRedaction: { sha256: oldHash },
    })
    await writeJson(path.join(attempt, "run-1/public/public-gallery-browser-report.json"), {
      traceRedaction: { sha256: oldHash },
    })
    await writeJson(path.join(attempt, "response-status-manifest.json"), {
      runs: [
        {
          run: 1,
          traceRedaction: { authoring: { sha256: oldHash }, public: { sha256: oldHash } },
        },
        {
          run: 2,
          traceRedaction: { authoring: { sha256: oldHash }, public: { sha256: oldHash } },
        },
      ],
    })
    await writeJson(path.join(attempt, "canonical-trace-manifest.json"), {
      traceRedaction: {
        archivePath: "task-10/attempt/task-10-authoring-trace.zip",
        sha256: oldHash,
      },
    })

    const inventory = []
    for (const [index, archivePath] of archives.entries()) {
      await writeFile(archivePath, `after-${index}`)
      inventory.push({
        afterSha256: sha256(`after-${index}`),
        beforeSha256: oldHash,
        path: path.relative(root, archivePath),
      })
    }
    const options = {
      archiveInventory: inventory,
      evidenceRoots: [path.join(root, "task-10")],
      repoRoot: root,
    }
    const refreshed = await refreshTraceHashReferences(options)
    const audit = await auditTraceHashReferences(options)

    assert.equal(refreshed.referencesUpdated, 7)
    assert.equal(refreshed.duplicateOldHashGroups, 1)
    assert.equal(audit.referenceCount, 7)
    assert.equal(audit.exactPathHashMatches, 7)
    assert.equal(audit.mismatches, 0)
    assert.equal(audit.missingArchives, 0)
    assert.equal(
      audit.references.every((reference) => reference.archivePath.length > 0),
      true,
    )
    assert.equal(new Set(audit.references.map((reference) => reference.sha256)).size, 5)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("fails instead of guessing when a declared trace archive path is unresolved", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "spolink-trace-reference-missing-"))
  try {
    const report = path.join(root, "task-10/attempt/run-1/public/failed-run-deadbeef.json")
    await mkdir(path.dirname(report), { recursive: true })
    await writeJson(report, { traceRedaction: { sha256: sha256("missing") } })
    await assert.rejects(
      refreshTraceHashReferences({
        archiveInventory: [],
        evidenceRoots: [path.join(root, "task-10")],
        repoRoot: root,
      }),
      /cannot resolve an intended archive path/u,
    )
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`)
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
