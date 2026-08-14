import { randomUUID } from "node:crypto"
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import {
  ALLOWED_CHANGE_PATHS,
  assertSortedUnique,
  entryFor,
  isEvidencePath,
  protectedPaths,
  sha256,
  sourceEntries,
} from "./opencode-direction-allowlist-manifest.mjs"

const ATOMIC_TEMPORARY_PATHS = new Set()

async function atomicWrite(path, contents, mode) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const existing = await lstat(path).catch(() => null)
  if (existing?.isSymbolicLink()) {
    throw new Error(`refusing to write through symbolic link: ${path}`)
  }
  const temporaryPath = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  ATOMIC_TEMPORARY_PATHS.add(temporaryPath)
  try {
    await writeFile(temporaryPath, contents, { encoding: "utf8", mode })
    await rename(temporaryPath, path)
  } finally {
    ATOMIC_TEMPORARY_PATHS.delete(temporaryPath)
    await rm(temporaryPath, { force: true })
  }
}

function registerInterruptionCleanup() {
  for (const [signal, exitCode] of [
    ["SIGHUP", 129],
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]) {
    process.once(signal, () => {
      void Promise.allSettled(
        [...ATOMIC_TEMPORARY_PATHS].map((path) => rm(path, { force: true })),
      ).then(() => {
        process.exit(exitCode)
      })
    })
  }
}

function parseBaseline(text) {
  let baseline
  try {
    baseline = JSON.parse(text)
  } catch {
    throw new Error("baseline is not valid JSON")
  }
  if (
    baseline?.version !== 1 ||
    baseline.algorithm !== "sha256" ||
    !Array.isArray(baseline.files)
  ) {
    throw new Error("baseline has an unsupported schema")
  }
  const paths = baseline.files.map((entry) => entry?.path)
  if (!paths.every((path) => typeof path === "string") || paths.some(isEvidencePath)) {
    throw new Error("baseline contains an invalid source path")
  }
  assertSortedUnique(paths, "baseline paths")
  for (const entry of baseline.files) {
    if (
      entry.type !== "file" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      entry.recordSha256 !== sha256(`${entry.path}\0${entry.type}\0${entry.sha256}`)
    ) {
      throw new Error(`baseline has an invalid hash record: ${entry.path}`)
    }
  }
  return baseline
}

function parseAllowlist(text) {
  if (!text.endsWith("\n")) {
    throw new Error("allowlist must end with a newline")
  }
  const paths = text.slice(0, -1).split("\n")
  assertSortedUnique(paths, "allowlist paths")
  if (paths.some((path) => !path || path.startsWith("/") || path.includes(".."))) {
    throw new Error("allowlist contains an invalid path")
  }
  if (
    paths.length !== ALLOWED_CHANGE_PATHS.length ||
    paths.some((path, index) => path !== ALLOWED_CHANGE_PATHS[index])
  ) {
    throw new Error("allowlist does not exactly match the ownership manifest")
  }
  return new Set(paths)
}

async function writeBaseline(baselinePath, allowlistPath) {
  assertSortedUnique(ALLOWED_CHANGE_PATHS, "ownership manifest paths")
  const files = await sourceEntries()
  const protectedEntries = await Promise.all((await protectedPaths()).map(entryFor))
  const baseline = { version: 1, algorithm: "sha256", files }
  await atomicWrite(allowlistPath, `${ALLOWED_CHANGE_PATHS.join("\n")}\n`, 0o600)
  await atomicWrite(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 0o600)
  const protectedPath = join(dirname(baselinePath), "protected-baseline.sha256")
  await atomicWrite(
    protectedPath,
    `${protectedEntries.map((entry) => `${entry.sha256}  ${entry.path}`).join("\n")}\n`,
    0o600,
  )
  console.log(
    `BASELINE OK: ${files.length} source files; ${protectedEntries.length} protected/package-lock files.`,
  )
}

async function verify(baselinePath, allowlistPath) {
  const baseline = parseBaseline(await readFile(baselinePath, "utf8"))
  const allowlist = parseAllowlist(await readFile(allowlistPath, "utf8"))
  const current = await sourceEntries()
  const priorByPath = new Map(baseline.files.map((entry) => [entry.path, entry]))
  const currentByPath = new Map(current.map((entry) => [entry.path, entry]))
  const deltas = []
  for (const entry of current) {
    const prior = priorByPath.get(entry.path)
    if (!prior) {
      deltas.push({ kind: "new", path: entry.path })
    } else if (prior.recordSha256 !== entry.recordSha256) {
      deltas.push({ kind: "changed", path: entry.path })
    }
  }
  for (const entry of baseline.files) {
    if (!currentByPath.has(entry.path)) {
      deltas.push({ kind: "deleted", path: entry.path })
    }
  }
  const rejected = deltas.filter((delta) => !allowlist.has(delta.path))
  if (rejected.length > 0) {
    throw new Error(
      `unallowlisted source delta: ${rejected.map((delta) => `${delta.kind}:${delta.path}`).join(", ")}`,
    )
  }
  console.log(
    `ALLOWLIST VERIFY OK: ${current.length} source files; ${deltas.length} allowlisted delta(s).`,
  )
}

async function main() {
  registerInterruptionCleanup()
  const [mode, baselinePath, allowlistPath, ...extra] = process.argv.slice(2)
  if (
    extra.length !== 0 ||
    (mode !== "baseline" && mode !== "verify") ||
    !baselinePath ||
    !allowlistPath
  ) {
    throw new Error(
      "usage: node scripts/verify-opencode-direction-allowlist.mjs <baseline|verify> <baseline.json> <allowed-change-paths.txt>",
    )
  }
  if (mode === "baseline") {
    await writeBaseline(baselinePath, allowlistPath)
  } else {
    await verify(baselinePath, allowlistPath)
  }
}

main().catch((error) => {
  console.error(`REJECT: ${error instanceof Error ? error.message : "unknown failure"}`)
  process.exitCode = 1
})
