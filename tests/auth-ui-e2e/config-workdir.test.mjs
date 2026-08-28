import assert from "node:assert/strict"
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { parse } from "@iarna/toml"

import { createAuthSupabaseWorkspace } from "./config-mode.mjs"

test("external auth workspace preserves repository config and contains exact 52022 overrides", async () => {
  const fixture = await createFixture()
  const before = await fileIdentity(fixture.configPath)
  let workspace
  try {
    workspace = await createAuthSupabaseWorkspace({
      baseUrl: "http://127.0.0.1:52022",
      enableConfirmations: true,
      lockPath: fixture.lockPath,
      repoRoot: fixture.repoRoot,
    })
    assert.deepEqual(await fileIdentity(fixture.configPath), before)
    assert.equal((await lstat(workspace.root)).mode & 0o777, 0o700)
    assert.equal((await lstat(workspace.configPath)).mode & 0o777, 0o600)
    const external = parse(await readFile(workspace.configPath, "utf8"))
    assert.equal(external.auth.site_url, "http://127.0.0.1:52022")
    assert.deepEqual(external.auth.additional_redirect_urls, [
      "http://127.0.0.1:52022/auth/callback",
      "http://127.0.0.1:52022/auth/callback?next=/auth/update-password",
    ])
    assert.equal(external.auth.email.enable_confirmations, true)
    assert.equal(
      await readFile(path.join(workspace.root, "supabase/migrations/001.sql"), "utf8"),
      "select 1;\n",
    )
    assert.doesNotMatch(
      await readFile(workspace.configPath, "utf8"),
      /private@example|literal-secret/u,
    )
  } finally {
    try {
      await workspace?.cleanup()
      await assert.rejects(() => access(workspace?.root ?? ""), /ENOENT/u)
      assert.deepEqual(await fileIdentity(fixture.configPath), before)
    } finally {
      await fixture.cleanup()
    }
  }
})

test("external auth workspace fails closed on concurrent and ambiguous ownership", async () => {
  const fixture = await createFixture()
  try {
    const first = await createAuthSupabaseWorkspace({
      baseUrl: "http://127.0.0.1:52022",
      enableConfirmations: false,
      lockPath: fixture.lockPath,
      repoRoot: fixture.repoRoot,
    })
    try {
      await assert.rejects(
        createAuthSupabaseWorkspace({
          baseUrl: "http://127.0.0.1:52023",
          enableConfirmations: false,
          lockPath: fixture.lockPath,
          repoRoot: fixture.repoRoot,
        }),
        /already active|ownership/u,
      )
    } finally {
      await first.cleanup()
    }

    const target = path.join(fixture.repoRoot, "ambiguous-lock-target")
    await writeFile(target, "ambiguous", { mode: 0o600 })
    await symlink(target, fixture.lockPath)
    try {
      await assert.rejects(
        createAuthSupabaseWorkspace({
          baseUrl: "http://127.0.0.1:52022",
          enableConfirmations: false,
          lockPath: fixture.lockPath,
          repoRoot: fixture.repoRoot,
        }),
        /already active|ownership/u,
      )
      assert.equal(await readFile(target, "utf8"), "ambiguous")
    } finally {
      await rm(fixture.lockPath, { force: true })
    }
  } finally {
    await fixture.cleanup()
  }
})

test("config fixture removes its partial root when setup serialization fails", async () => {
  const circular = {}
  circular.self = circular
  let unexpectedFixture
  const before = await matchingRoots("spolink-auth-workdir-fixture-")
  try {
    await assert.rejects(async () => {
      unexpectedFixture = await createFixture({ packageManifest: circular })
    }, /circular/u)
    assert.deepEqual(await matchingRoots("spolink-auth-workdir-fixture-"), before)
  } finally {
    await unexpectedFixture?.cleanup()
  }
})

async function matchingRoots(prefix) {
  return (await readdir(os.tmpdir())).filter((name) => name.startsWith(prefix)).sort()
}

async function createFixture({
  packageManifest = { packageManager: "pnpm@10.25.0", private: true },
} = {}) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "spolink-auth-workdir-fixture-"))
  try {
    return await initializeFixture(repoRoot, packageManifest)
  } catch (error) {
    await rm(repoRoot, { force: true, recursive: true })
    throw error
  }
}

async function initializeFixture(repoRoot, packageManifest) {
  const configPath = path.join(repoRoot, "supabase/config.toml")
  const lockPath = path.join(repoRoot, "auth-workspace.lock")
  await mkdir(path.join(repoRoot, "supabase/migrations"), { recursive: true })
  await mkdir(path.join(repoRoot, "scripts"), { recursive: true })
  await writeFile(path.join(repoRoot, "package.json"), `${JSON.stringify(packageManifest)}\n`)
  await writeFile(
    configPath,
    `project_id = "spolink"
[auth]
site_url = "http://127.0.0.1:3000"
additional_redirect_urls = ["http://127.0.0.1:3000"]
[auth.email]
enable_confirmations = false
`,
    { mode: 0o644 },
  )
  await writeFile(path.join(repoRoot, "supabase/migrations/001.sql"), "select 1;\n")
  await writeFile(path.join(repoRoot, "scripts/supabase-local.mjs"), "// fixture\n")
  return {
    cleanup: () => rm(repoRoot, { force: true, recursive: true }),
    configPath,
    lockPath,
    repoRoot,
  }
}

async function fileIdentity(filePath) {
  const stat = await lstat(filePath)
  return { bytes: await readFile(filePath), ino: stat.ino, mode: stat.mode }
}
