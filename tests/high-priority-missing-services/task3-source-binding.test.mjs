import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { chmod, link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { promisify } from "node:util"

import { computeTask3SourceBinding } from "./task3-evidence.mjs"

const execFileAsync = promisify(execFile)
const devNextEnv = nextEnv('import "./.next/dev/types/routes.d.ts";')
const productionNextEnv = nextEnv('import "./.next/types/routes.d.ts";')
const generatedBranchPath = "supabase/.branches/_current_branch"

test("source binding normalizes only validated generated next-env transitions", async () => {
  const repoRoot = await createRepo()
  const nextEnvPath = path.join(repoRoot, "next-env.d.ts")
  const sourcePath = path.join(repoRoot, "source.mjs")
  try {
    const before = await computeTask3SourceBinding(repoRoot)
    await writeFile(nextEnvPath, productionNextEnv)
    assert.deepEqual(await computeTask3SourceBinding(repoRoot), before)

    await writeFile(sourcePath, "export const value = 2\n")
    const realDrift = await computeTask3SourceBinding(repoRoot)
    assert.notEqual(realDrift.manifestSha256, before.manifestSha256)
    assert.notEqual(realDrift.statusSha256, before.statusSha256)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("source binding rejects arbitrary, symlinked, executable, and hardlinked next-env entries", async () => {
  for (const kind of ["arbitrary", "symlink", "executable", "hardlink"]) {
    const repoRoot = await createRepo()
    const nextEnvPath = path.join(repoRoot, "next-env.d.ts")
    try {
      if (kind === "arbitrary") await writeFile(nextEnvPath, "arbitrary bytes\n")
      if (kind === "symlink") {
        await rm(nextEnvPath)
        await symlink("source.mjs", nextEnvPath)
      }
      if (kind === "executable") await chmod(nextEnvPath, 0o755)
      if (kind === "hardlink") await link(nextEnvPath, path.join(repoRoot, "next-env-copy.d.ts"))
      await assert.rejects(computeTask3SourceBinding(repoRoot), /next-env\.d\.ts/)
    } finally {
      await rm(repoRoot, { force: true, recursive: true })
    }
  }
})

test("source binding is stable across absent and exact live Supabase branch state", async () => {
  const repoRoot = await createRepo()
  const branchPath = path.join(repoRoot, generatedBranchPath)
  try {
    const stopped = await computeTask3SourceBinding(repoRoot)
    await mkdir(path.dirname(branchPath), { recursive: true })
    await writeFile(branchPath, "main")
    assert.deepEqual(await computeTask3SourceBinding(repoRoot), stopped)

    await rm(branchPath)
    assert.deepEqual(await computeTask3SourceBinding(repoRoot), stopped)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("source binding normalizes a private generated Supabase branch marker", async () => {
  const repoRoot = await createRepo()
  const branchPath = path.join(repoRoot, generatedBranchPath)
  try {
    const stopped = await computeTask3SourceBinding(repoRoot)
    await mkdir(path.dirname(branchPath), { recursive: true })
    await writeFile(branchPath, "main", { mode: 0o600 })
    assert.deepEqual(await computeTask3SourceBinding(repoRoot), stopped)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("source binding rejects invalid Supabase branch markers and preserves other drift", async () => {
  for (const kind of ["arbitrary", "symlink", "executable", "hardlink"]) {
    const repoRoot = await createRepo()
    const branchPath = path.join(repoRoot, generatedBranchPath)
    try {
      await mkdir(path.dirname(branchPath), { recursive: true })
      if (kind === "arbitrary") await writeFile(branchPath, "not-main")
      if (kind === "symlink") await symlink("../../source.mjs", branchPath)
      if (kind === "executable") {
        await writeFile(branchPath, "main")
        await chmod(branchPath, 0o755)
      }
      if (kind === "hardlink") {
        await writeFile(branchPath, "main")
        await link(branchPath, path.join(repoRoot, "branch-copy"))
      }
      await assert.rejects(computeTask3SourceBinding(repoRoot), /_current_branch/)
    } finally {
      await rm(repoRoot, { force: true, recursive: true })
    }
  }

  const repoRoot = await createRepo()
  const branchPath = path.join(repoRoot, generatedBranchPath)
  try {
    const before = await computeTask3SourceBinding(repoRoot)
    await mkdir(path.dirname(branchPath), { recursive: true })
    await writeFile(branchPath, "main")
    await writeFile(path.join(path.dirname(branchPath), "unexpected"), "drift")
    const siblingDrift = await computeTask3SourceBinding(repoRoot)
    assert.notEqual(siblingDrift.manifestSha256, before.manifestSha256)
    assert.notEqual(siblingDrift.statusSha256, before.statusSha256)

    await rm(path.join(path.dirname(branchPath), "unexpected"))
    await writeFile(path.join(repoRoot, "source.mjs"), "export const value = 2\n")
    const sourceDrift = await computeTask3SourceBinding(repoRoot)
    assert.notEqual(sourceDrift.manifestSha256, before.manifestSha256)
    assert.notEqual(sourceDrift.statusSha256, before.statusSha256)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

async function createRepo() {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "spolink-task3-binding-"))
  await execFileAsync("git", ["init", "--quiet"], { cwd: repoRoot })
  await execFileAsync("git", ["config", "user.email", "binding@example.invalid"], {
    cwd: repoRoot,
  })
  await execFileAsync("git", ["config", "user.name", "Binding Test"], { cwd: repoRoot })
  await writeFile(path.join(repoRoot, "next-env.d.ts"), devNextEnv)
  await writeFile(path.join(repoRoot, "source.mjs"), "export const value = 1\n")
  await execFileAsync("git", ["add", "."], { cwd: repoRoot })
  await execFileAsync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: repoRoot })
  return repoRoot
}

function nextEnv(routeImport) {
  return `/// <reference types="next" />
/// <reference types="next/image-types/global" />
${routeImport}

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
`
}
