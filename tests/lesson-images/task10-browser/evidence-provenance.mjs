import assert from "node:assert/strict"
import { readdir, stat } from "node:fs/promises"
import path from "node:path"

export function readEvidenceConfiguration(argument, startedAt) {
  const evidenceDir = path.resolve(argument ?? "")
  if (!argument || !evidenceDir.includes("/.omo/evidence/lesson-image-upload/task-10/")) {
    throw new TypeError(
      "Task 10 evidence directory must be under .omo/evidence/lesson-image-upload/task-10",
    )
  }
  const directoryName = path.basename(evidenceDir)
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\+0900-remediation$/u.exec(
    directoryName,
  )
  assert.ok(match, "evidence directory must use YYYYMMDDTHHmmss+0900-remediation")
  const [, year, month, day, hour, minute, second] = match
  const directoryTimestamp = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`)
  const deltaMs = startedAt.getTime() - directoryTimestamp.getTime()
  assert.ok(deltaMs >= 0 && deltaMs <= 120_000, "evidence directory timestamp is stale or future")
  return {
    evidenceDir,
    provenance: {
      derivation:
        "Generated immediately before invocation from the current Asia/Seoul wall clock as YYYYMMDDTHHmmss+0900-remediation",
      directoryName,
      directoryTimestampAsiaSeoul: `${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`,
      startDeltaMs: deltaMs,
    },
  }
}

export async function writeTimestampReport(context) {
  const runnerFinishedAt = new Date()
  const artifactFiles = []
  await collectFiles(context.evidenceDir, artifactFiles)
  const artifacts = await Promise.all(
    artifactFiles
      .filter((file) => path.basename(file) !== "timestamp-provenance.json")
      .sort()
      .map(async (file) => {
        const metadata = await stat(file)
        return {
          bytes: metadata.size,
          mtimeUtc: metadata.mtime.toISOString(),
          path: path.relative(context.evidenceDir, file),
        }
      }),
  )
  const lowerBound = context.runnerStartedAt.getTime() - 5_000
  const upperBound = runnerFinishedAt.getTime() + 5_000
  const conflictingMtimes = artifacts
    .filter((artifact) => {
      const mtime = new Date(artifact.mtimeUtc).getTime()
      return mtime < lowerBound || mtime > upperBound
    })
    .map((artifact) => artifact.path)
  assert.deepEqual(conflictingMtimes, [])
  await context.writePrivateJson("timestamp-provenance.json", {
    ...context.directoryProvenance,
    artifactMtimes: artifacts,
    conflictingMtimes,
    filesystemMtimeConflict: false,
    runnerFinishedAsiaSeoul: formatAsiaSeoul(runnerFinishedAt),
    runnerFinishedUtc: runnerFinishedAt.toISOString(),
    runnerStartedAsiaSeoul: formatAsiaSeoul(context.runnerStartedAt),
    runnerStartedUtc: context.runnerStartedAt.toISOString(),
  })
}

async function collectFiles(directory, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) await collectFiles(target, files)
    else if (entry.isFile()) files.push(target)
  }
}

function formatAsiaSeoul(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone: "Asia/Seoul",
      year: "numeric",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+09:00`
}
