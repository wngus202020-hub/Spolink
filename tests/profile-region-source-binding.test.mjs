import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { promisify } from "node:util"

import {
  canonicalBindingJson,
  createCanonicalBinding,
  generateCanonicalBinding,
  profileRegionSourceBindingPaths,
  readAndValidateCanonicalBinding,
  serializeCanonicalBindingLines,
  validateCanonicalBinding,
  writeCanonicalBinding,
} from "../scripts/profile-region-source-binding.mjs"

const legacyBindingPath = ".omo/evidence/profile-region-server-hardening/task-15/final-binding.json"
const execFileAsync = promisify(execFile)

function independentlySerializeDeclaredLines(files) {
  return Buffer.from(
    [...files]
      .sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)))
      .map(({ path, sha256 }) => `${sha256}  ${path}\n`)
      .join(""),
    "utf8",
  )
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

test("Given the legacy exact48 manifest When validating the Todo1-16 source set Then it is rejected", async () => {
  const manifest = JSON.parse(await readFile(legacyBindingPath, "utf8"))

  const independentlyComputed = sha256(independentlySerializeDeclaredLines(manifest.files))

  assert.equal(independentlyComputed, manifest.aggregateSha256)
  await assert.rejects(validateCanonicalBinding(manifest), /binding schema keys are not exact/)
})

test("Given canonical source entries When serializing twice Then JSON and aggregate are byte-identical", () => {
  const files = profileRegionSourceBindingPaths.map((filePath, index) => ({
    path: filePath,
    sha256: index.toString(16).padStart(64, "0"),
  }))
  const first = createCanonicalBinding({ files, gitHead: "a".repeat(40) })
  const second = createCanonicalBinding({ files, gitHead: "a".repeat(40) })

  assert.deepEqual(canonicalBindingJson(first), canonicalBindingJson(second))
  assert.equal(first.aggregateSha256, second.aggregateSha256)
  assert.deepEqual(
    serializeCanonicalBindingLines(first.files),
    independentlySerializeDeclaredLines(first.files),
  )
})

test("Given the current Todo1-16 source set When generating twice Then both persisted bindings validate byte-identically", async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "spolink-binding-"))
  t.after(async () => rm(workspace, { force: true, recursive: true }))
  const firstPath = path.join(workspace, "first.json")
  const secondPath = path.join(workspace, "second.json")

  const first = await writeCanonicalBinding(firstPath)
  const second = await writeCanonicalBinding(secondPath)

  assert.deepEqual(await readFile(firstPath), await readFile(secondPath))
  assert.equal(first.aggregateSha256, second.aggregateSha256)
  await readAndValidateCanonicalBinding(firstPath)
  await readAndValidateCanonicalBinding(secondPath)
})

test("Given the binding CLI When generating and verifying Then both commands produce observables", async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "spolink-binding-cli-"))
  t.after(async () => rm(workspace, { force: true, recursive: true }))
  const outputPath = path.join(workspace, "binding.json")

  const generated = await execFileAsync(process.execPath, [
    "scripts/profile-region-source-binding.mjs",
    "generate",
    outputPath,
  ])
  const verified = await execFileAsync(process.execPath, [
    "scripts/profile-region-source-binding.mjs",
    "verify",
    outputPath,
  ])

  assert.match(generated.stdout, /"pathCount":50/u)
  assert.match(verified.stdout, /"pathCount":50/u)
  await readAndValidateCanonicalBinding(outputPath)
})

test("Given a manifest with a stale stored aggregate When independently recomputing canonical lines Then validation rejects it", async () => {
  const binding = await generateCanonicalBinding()
  const independentlyComputed = sha256(independentlySerializeDeclaredLines(binding.files))
  const staleAggregate = { ...binding, aggregateSha256: "0".repeat(64) }

  assert.equal(independentlyComputed, binding.aggregateSha256)
  assert.notEqual(independentlyComputed, staleAggregate.aggregateSha256)
  await assert.rejects(
    validateCanonicalBinding(staleAggregate),
    /binding aggregate does not match canonical lines/,
  )
})

test("Given malformed canonical manifests When validating Then every alternate representation is rejected", async () => {
  const files = profileRegionSourceBindingPaths.map((filePath, index) => ({
    path: filePath,
    sha256: index.toString(16).padStart(64, "0"),
  }))
  const canonical = createCanonicalBinding({ files, gitHead: "a".repeat(40) })
  const cases = [
    [
      "missing",
      { ...canonical, files: canonical.files.slice(1), pathCount: canonical.pathCount - 1 },
    ],
    [
      "extra",
      { ...canonical, files: [...canonical.files, { path: "z-extra", sha256: "b".repeat(64) }] },
    ],
    ["duplicate", { ...canonical, files: [...canonical.files, canonical.files.at(-1)] }],
    [
      "tampered",
      {
        ...canonical,
        files: [{ ...canonical.files[0], sha256: "f".repeat(64) }, ...canonical.files.slice(1)],
      },
    ],
    ["unsorted", { ...canonical, files: [...canonical.files].reverse() }],
    [
      "one-space",
      {
        ...canonical,
        aggregateSha256: sha256(
          Buffer.from(
            canonical.files
              .map(({ path: filePath, sha256: hash }) => `${hash} ${filePath}\n`)
              .join(""),
            "utf8",
          ),
        ),
      },
    ],
    [
      "no-final-newline",
      {
        ...canonical,
        aggregateSha256: sha256(serializeCanonicalBindingLines(canonical.files).subarray(0, -1)),
      },
    ],
    [
      "crlf",
      {
        ...canonical,
        aggregateSha256: sha256(
          Buffer.from(
            canonical.files
              .map(({ path: filePath, sha256: hash }) => `${hash}  ${filePath}\r\n`)
              .join(""),
            "utf8",
          ),
        ),
      },
    ],
    [
      "uppercase-hash",
      {
        ...canonical,
        files: [
          { ...canonical.files[0], sha256: canonical.files[0].sha256.toUpperCase() },
          ...canonical.files.slice(1),
        ],
      },
    ],
    [
      "path-normalization",
      {
        ...canonical,
        files: [
          { ...canonical.files[0], path: canonical.files[0].path.normalize("NFD") },
          ...canonical.files.slice(1),
        ],
      },
    ],
  ]

  for (const [name, manifest] of cases) {
    await assert.rejects(validateCanonicalBinding(manifest), undefined, name)
  }
})

test("Given noncanonical JSON bytes When reading a binding Then CRLF and missing final newline are rejected", async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "spolink-binding-"))
  t.after(async () => rm(workspace, { force: true, recursive: true }))
  const binding = await generateCanonicalBinding()
  for (const [name, bytes] of [
    ["crlf", canonicalBindingJson(binding).toString("utf8").replaceAll("\n", "\r\n")],
    ["no-final-newline", canonicalBindingJson(binding).subarray(0, -1)],
  ]) {
    const filePath = path.join(workspace, `${name}.json`)
    await writeFile(filePath, bytes, { mode: 0o600 })
    await chmod(filePath, 0o600)
    await assert.rejects(
      readAndValidateCanonicalBinding(filePath),
      /binding JSON bytes are not canonical/,
    )
  }
})
