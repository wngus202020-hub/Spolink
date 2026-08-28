import { constants } from "node:fs"
import { lstat, open } from "node:fs/promises"
import path from "node:path"

import { Task3EvidenceError, task3Sha256 } from "./task3-evidence-validation.mjs"

export const generatedNextEnvPath = "next-env.d.ts"
export const generatedNextEnvMarker = "generated-next-env:v1:type=regular;mode=100644;links=1"
export const generatedSupabaseBranchPath = "supabase/.branches/_current_branch"
export const generatedSupabaseBranchMarker =
  "generated-supabase-current-branch:v1:type=regular;mode=private-or-default;links=1;schema=main"

const generatedNextEnvSchemas = new Map([
  [nextEnvText('import "./.next/dev/types/routes.d.ts";'), "dev"],
  [nextEnvText('import "./.next/types/routes.d.ts";'), "production"],
])
const generatedSupabaseBranchBody = Buffer.from("main")
const generatedSupabaseBranchSha256 =
  "0d6e4079e36703ebd37c00722f5891d28b0e2811dc114b129215123adcce3605"

export async function readValidatedGeneratedNextEnv(repoRoot) {
  const filePath = path.join(repoRoot, generatedNextEnvPath)
  const before = await lstat(filePath, { bigint: true }).catch((error) => {
    throw new Task3EvidenceError(`next-env.d.ts lstat failed: ${error.code ?? "unknown"}`)
  })
  if (!before.isFile() || before.isSymbolicLink())
    throw new Task3EvidenceError("next-env.d.ts must be a regular non-symlink file")
  if ((before.mode & 0o177777n) !== 0o100644n)
    throw new Task3EvidenceError("next-env.d.ts must have regular mode 100644")
  if (before.nlink !== 1n)
    throw new Task3EvidenceError("next-env.d.ts must have exactly one hard link")
  let handle
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
    const opened = await handle.stat({ bigint: true })
    const body = await handle.readFile()
    const after = await handle.stat({ bigint: true })
    if (
      !sameGeneratedIdentity(before, opened) ||
      !sameGeneratedIdentity(opened, after) ||
      after.size !== BigInt(body.byteLength)
    )
      throw new Task3EvidenceError("next-env.d.ts changed while binding was captured")
    const schema = generatedNextEnvSchemas.get(body.toString("utf8"))
    if (!schema) throw new Task3EvidenceError("next-env.d.ts has an unexpected generated schema")
    return { identity: generatedIdentity(after), schema, sha256: task3Sha256(body) }
  } catch (error) {
    if (error?.code === "ELOOP")
      throw new Task3EvidenceError("next-env.d.ts must be a regular non-symlink file")
    throw error
  } finally {
    await handle?.close()
  }
}

export function validateGeneratedNextEnvIndex(entry, body) {
  if (!/^100644 [a-f0-9]{40} 0\tnext-env\.d\.ts\n$/u.test(entry))
    throw new Task3EvidenceError("next-env.d.ts index entry must have mode 100644")
  const schema = generatedNextEnvSchemas.get(body.toString("utf8"))
  if (!schema) throw new Task3EvidenceError("next-env.d.ts index has an unexpected schema")
  return schema
}

export function normalizeGeneratedNextEnvStatus(status, indexSchema, worktreeSchema) {
  if (indexSchema === worktreeSchema) return status
  const transition = Buffer.from(` M ${generatedNextEnvPath}\0`)
  const first = status.indexOf(transition)
  if (first === -1 || status.indexOf(transition, first + transition.length) !== -1) return status
  return Buffer.concat([status.subarray(0, first), status.subarray(first + transition.length)])
}

export async function revalidateGeneratedNextEnv(repoRoot, expected) {
  const current = await readValidatedGeneratedNextEnv(repoRoot)
  if (
    current.schema !== expected.schema ||
    current.sha256 !== expected.sha256 ||
    !sameGeneratedIdentity(current.identity, expected.identity)
  )
    throw new Task3EvidenceError("next-env.d.ts drifted during binding capture")
}

export async function readValidatedGeneratedSupabaseBranch(repoRoot) {
  const filePath = path.join(repoRoot, generatedSupabaseBranchPath)
  const before = await lstat(filePath, { bigint: true }).catch((error) => {
    if (error?.code === "ENOENT") return null
    throw new Task3EvidenceError(
      `supabase/.branches/_current_branch lstat failed: ${error.code ?? "unknown"}`,
    )
  })
  if (!before) return { state: "absent" }
  if (!before.isFile() || before.isSymbolicLink())
    throw new Task3EvidenceError(
      "supabase/.branches/_current_branch must be a regular non-symlink file",
    )
  if (![0o100600n, 0o100644n].includes(before.mode & 0o177777n))
    throw new Task3EvidenceError(
      "supabase/.branches/_current_branch must have regular mode 100600 or 100644",
    )
  if (before.nlink !== 1n)
    throw new Task3EvidenceError(
      "supabase/.branches/_current_branch must have exactly one hard link",
    )
  let handle
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
    const opened = await handle.stat({ bigint: true })
    const body = await handle.readFile()
    const after = await handle.stat({ bigint: true })
    if (
      !sameGeneratedIdentity(before, opened) ||
      !sameGeneratedIdentity(opened, after) ||
      after.size !== BigInt(body.byteLength)
    )
      throw new Task3EvidenceError(
        "supabase/.branches/_current_branch changed while binding was captured",
      )
    if (
      !body.equals(generatedSupabaseBranchBody) ||
      task3Sha256(body) !== generatedSupabaseBranchSha256
    )
      throw new Task3EvidenceError(
        "supabase/.branches/_current_branch has unexpected generated content",
      )
    return {
      identity: generatedIdentity(after),
      sha256: generatedSupabaseBranchSha256,
      state: "present",
    }
  } catch (error) {
    if (error?.code === "ELOOP")
      throw new Task3EvidenceError(
        "supabase/.branches/_current_branch must be a regular non-symlink file",
      )
    throw error
  } finally {
    await handle?.close()
  }
}

export function normalizeGeneratedSupabaseBranchStatus(status, generatedBranch) {
  if (generatedBranch.state === "absent") return status
  const record = Buffer.from(`?? ${generatedSupabaseBranchPath}\0`)
  const first = status.indexOf(record)
  if (first === -1 || status.indexOf(record, first + record.length) !== -1)
    throw new Task3EvidenceError(
      "supabase/.branches/_current_branch must have one exact untracked status record",
    )
  return Buffer.concat([status.subarray(0, first), status.subarray(first + record.length)])
}

export async function revalidateGeneratedSupabaseBranch(repoRoot, expected) {
  const current = await readValidatedGeneratedSupabaseBranch(repoRoot)
  if (current.state !== expected.state) {
    throw new Task3EvidenceError(
      "supabase/.branches/_current_branch drifted during binding capture",
    )
  }
  if (
    current.state === "present" &&
    (current.sha256 !== expected.sha256 ||
      !sameGeneratedIdentity(current.identity, expected.identity))
  )
    throw new Task3EvidenceError(
      "supabase/.branches/_current_branch drifted during binding capture",
    )
}

function generatedIdentity(fileStat) {
  return {
    dev: fileStat.dev,
    ino: fileStat.ino,
    mode: fileStat.mode,
    nlink: fileStat.nlink,
    size: fileStat.size,
    mtimeNs: fileStat.mtimeNs,
  }
}

function sameGeneratedIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs
  )
}

function nextEnvText(routeImport) {
  return `/// <reference types="next" />
/// <reference types="next/image-types/global" />
${routeImport}

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
`
}
