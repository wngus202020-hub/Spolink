#!/usr/bin/env node
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { chmod, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export const canonicalBindingAlgorithm =
  "sha256 of UTF-8 byte-path-sorted lines: <fileSha256><two spaces><path><newline>"

export const profileRegionSourceBindingPaths = Object.freeze([
  "SPOLINK_API_명세서.md",
  "SPOLINK_화면_설계.md",
  "components/onboarding/profile-onboarding-form.tsx",
  "components/profile/profile-edit-form-state.ts",
  "components/profile/profile-edit-form.tsx",
  "components/profile/profile-region-picker.tsx",
  "lib/profile/edit-contract.ts",
  "lib/profile/region-contract.ts",
  "lib/profile/validation.ts",
  "package.json",
  "scripts/profile-region-source-binding.mjs",
  "scripts/supabase-local/stopped-state.mjs",
  "tests/auth-ui-e2e/fake-lifecycle-harness.mjs",
  "tests/auth-ui-e2e/lifecycle-cleanup.mjs",
  "tests/auth-ui-e2e/lifecycle-core.mjs",
  "tests/auth-ui-e2e/lifecycle-signal-cases.mjs",
  "tests/auth-ui-e2e/lifecycle.mjs",
  "tests/auth-ui-e2e/mypage-profile-edit-partial-scenario.ts",
  "tests/auth-ui-e2e/mypage-profile-edit-runner-corepack-fixture.mjs",
  "tests/auth-ui-e2e/mypage-profile-edit-runner-fixture.mjs",
  "tests/auth-ui-e2e/mypage-profile-edit-runner-ownership.test.mjs",
  "tests/auth-ui-e2e/mypage-profile-edit-runner-visual-publication.mjs",
  "tests/auth-ui-e2e/mypage-profile-edit-runner-visual.mjs",
  "tests/auth-ui-e2e/mypage-profile-edit-runner.test.mjs",
  "tests/auth-ui-e2e/mypage-profile-edit-runtime-cleanup.mjs",
  "tests/auth-ui-e2e/mypage-profile-edit-visual.ts",
  "tests/auth-ui-e2e/mypage-profile-edit.spec.ts",
  "tests/auth-ui-e2e/onboarding-shell-contract.test.mjs",
  "tests/auth-ui-e2e/onboarding-shell.spec.ts",
  "tests/auth-ui-e2e/profile-api.test.mjs",
  "tests/auth-ui-e2e/run-mypage-profile-edit.mjs",
  "tests/auth-ui-e2e/run-onboarding-shell.mjs",
  "tests/auth-ui-e2e/signup-onboarding-login-browser.ts",
  "tests/auth-ui-e2e/signup-onboarding-login-helpers.test.mjs",
  "tests/auth-ui-e2e/signup-onboarding-login-helpers.ts",
  "tests/auth-ui-e2e/supabase-cli-temp-lifecycle.test.mjs",
  "tests/mypage-profile-edit-contract.test.mjs",
  "tests/mypage-profile-edit-docs-assertions.mjs",
  "tests/mypage-profile-edit-docs-contract.test.mjs",
  "tests/mypage-profile-edit-form.test.mjs",
  "tests/mypage-profile-region-picker.test.mjs",
  "tests/profile-api/documentation-contract.test.mjs",
  "tests/profile-api/fixtures.mjs",
  "tests/profile-api/lifecycle-contract.test.mjs",
  "tests/profile-api/region-contract.test.mjs",
  "tests/profile-api/route-handlers-mutation.test.mjs",
  "tests/profile-api/route-handlers.test.mjs",
  "tests/profile-api/validation.test.mjs",
  "tests/profile-region-source-binding.test.mjs",
  "tests/supabase-local-guard/temp-residue.test.mjs",
])

const requiredBindingKeys = Object.freeze([
  "schemaVersion",
  "type",
  "gitHead",
  "algorithm",
  "scope",
  "pathCount",
  "uniquePathCount",
  "aggregateSha256",
  "files",
  "selfHash",
])

export function compareUtf8PathBytes(left, right) {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"))
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

export function serializeCanonicalBindingLines(files) {
  assertCanonicalFiles(files)
  return Buffer.from(
    files.map(({ sha256: hash, path: filePath }) => `${hash}  ${filePath}\n`).join(""),
    "utf8",
  )
}

export function aggregateCanonicalBindingFiles(files) {
  return sha256(serializeCanonicalBindingLines(files))
}

export function createCanonicalBinding({ files, gitHead }) {
  assertCanonicalFiles(files)
  if (!/^[a-f0-9]{40}$/u.test(gitHead)) throw new Error("git head must be a full lowercase SHA-1")
  const payload = {
    schemaVersion: 4,
    type: "profile-region-server-hardening-canonical-source-binding",
    gitHead,
    algorithm: canonicalBindingAlgorithm,
    scope:
      "Complete Todo1-16 changed source, test, and product documentation union; evidence excluded.",
    pathCount: files.length,
    uniquePathCount: files.length,
    aggregateSha256: aggregateCanonicalBindingFiles(files),
    files,
  }
  return {
    ...payload,
    selfHash: {
      algorithm: "sha256",
      scope: "canonical JSON payload before selfHash insertion",
      value: sha256(canonicalBindingJson(payload)),
    },
  }
}

export function canonicalBindingJson(binding) {
  return Buffer.from(`${JSON.stringify(binding, null, 2)}\n`, "utf8")
}

export async function collectCanonicalBindingFiles(repoRoot = process.cwd()) {
  const files = []
  for (const filePath of profileRegionSourceBindingPaths) {
    files.push({ path: filePath, sha256: sha256(await readFile(path.join(repoRoot, filePath))) })
  }
  assertCanonicalFiles(files)
  return files
}

export async function generateCanonicalBinding(repoRoot = process.cwd()) {
  const files = await collectCanonicalBindingFiles(repoRoot)
  const gitHead = (
    await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot })
  ).stdout.trim()
  return createCanonicalBinding({ files, gitHead })
}

export async function writeCanonicalBinding(outputPath, repoRoot = process.cwd()) {
  const binding = await generateCanonicalBinding(repoRoot)
  await writeFile(outputPath, canonicalBindingJson(binding), { mode: 0o600 })
  await chmod(outputPath, 0o600)
  return binding
}

export async function readAndValidateCanonicalBinding(inputPath, repoRoot = process.cwd()) {
  const bytes = await readFile(inputPath)
  const binding = JSON.parse(bytes.toString("utf8"))
  await validateCanonicalBinding(binding, repoRoot)
  if (!bytes.equals(canonicalBindingJson(binding))) {
    throw new Error("binding JSON bytes are not canonical UTF-8 with one final newline")
  }
  return binding
}

export async function validateCanonicalBinding(binding, repoRoot = process.cwd()) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    throw new Error("binding must be an object")
  }
  if (JSON.stringify(Object.keys(binding)) !== JSON.stringify(requiredBindingKeys)) {
    throw new Error("binding schema keys are not exact")
  }
  if (
    binding.schemaVersion !== 4 ||
    binding.type !== "profile-region-server-hardening-canonical-source-binding"
  ) {
    throw new Error("binding schema is unsupported")
  }
  if (binding.algorithm !== canonicalBindingAlgorithm)
    throw new Error("binding algorithm is not canonical")
  if (
    binding.scope !==
    "Complete Todo1-16 changed source, test, and product documentation union; evidence excluded."
  ) {
    throw new Error("binding scope is not canonical")
  }
  if (!/^[a-f0-9]{40}$/u.test(binding.gitHead)) throw new Error("binding git head is invalid")
  assertCanonicalFiles(binding.files)
  assertExpectedPaths(binding.files)
  if (
    binding.pathCount !== binding.files.length ||
    binding.uniquePathCount !== binding.files.length
  ) {
    throw new Error("binding path counts are invalid")
  }
  if (binding.aggregateSha256 !== aggregateCanonicalBindingFiles(binding.files)) {
    throw new Error("binding aggregate does not match canonical lines")
  }
  const { selfHash, ...payload } = binding
  if (
    selfHash?.algorithm !== "sha256" ||
    selfHash?.scope !== "canonical JSON payload before selfHash insertion" ||
    selfHash?.value !== sha256(canonicalBindingJson(payload))
  ) {
    throw new Error("binding self hash is invalid")
  }
  const generated = await generateCanonicalBinding(repoRoot)
  if (binding.gitHead !== generated.gitHead) throw new Error("binding git head is stale")
  if (JSON.stringify(binding) !== JSON.stringify(generated))
    throw new Error("binding file hashes are stale")
  return binding
}

function assertCanonicalFiles(files) {
  if (!Array.isArray(files) || files.length === 0) throw new Error("binding files are required")
  let previousPath = null
  const seen = new Set()
  for (const file of files) {
    if (!file || typeof file !== "object" || Object.keys(file).length !== 2) {
      throw new Error("binding file schema is invalid")
    }
    if (
      typeof file.path !== "string" ||
      !file.path ||
      file.path.includes("\\") ||
      file.path.includes("\0") ||
      file.path !== file.path.normalize("NFC") ||
      !/^[a-f0-9]{64}$/u.test(file.sha256)
    ) {
      throw new Error("binding file is not canonical")
    }
    if (seen.has(file.path)) throw new Error(`binding duplicate path: ${file.path}`)
    if (previousPath !== null && compareUtf8PathBytes(previousPath, file.path) >= 0) {
      throw new Error("binding paths are not UTF-8 byte sorted")
    }
    seen.add(file.path)
    previousPath = file.path
  }
}

function assertExpectedPaths(files) {
  if (
    JSON.stringify(files.map((file) => file.path)) !==
    JSON.stringify(profileRegionSourceBindingPaths)
  ) {
    throw new Error("binding paths do not match the Todo1-16 source set")
  }
}

async function main() {
  const [command, target] = process.argv.slice(2)
  if (command === "generate" && target) {
    const binding = await writeCanonicalBinding(target)
    console.log(
      JSON.stringify({ aggregateSha256: binding.aggregateSha256, pathCount: binding.pathCount }),
    )
    return
  }
  if (command === "verify" && target) {
    const binding = await readAndValidateCanonicalBinding(target)
    console.log(
      JSON.stringify({ aggregateSha256: binding.aggregateSha256, pathCount: binding.pathCount }),
    )
    return
  }
  throw new Error(
    "usage: node scripts/profile-region-source-binding.mjs generate|verify <binding-path>",
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
