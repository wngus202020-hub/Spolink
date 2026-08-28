import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { chmod, link, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { promisify } from "node:util"

import { computeTask3SourceBinding, isStableInventoryFile } from "./task3-source-binding.mjs"

const execFileAsync = promisify(execFile)
const expectedManifestSha256 = "ef824dc277607848deac13692f80762df2ac1db72e37a6616678a7c192ed5183"
const emptyStatusSha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

test("source binding preserves stable manifest, status hashes, and metadata", async () => {
  const metadata = {
    dev: 1n,
    ino: 2n,
    size: 3n,
    mode: 0o100644n,
    nlink: 1n,
    uid: 501n,
    gid: 20n,
    isFile: () => true,
    isSymbolicLink: () => false,
  }
  assert.equal(isStableInventoryFile(metadata, { ...metadata }), true)
  assert.equal(isStableInventoryFile(metadata, { ...metadata, uid: 502n }), false)
  assert.equal(isStableInventoryFile(metadata, { ...metadata, gid: 21n }), false)

  const repoRoot = await createRepo()
  try {
    const first = await computeTask3SourceBinding(repoRoot)
    const second = await computeTask3SourceBinding(repoRoot)
    assert.equal(first.manifestSha256, expectedManifestSha256)
    assert.equal(first.statusSha256, emptyStatusSha256)
    assert.deepEqual(second, first)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("source binding reads a safe file through one stable inventory identity", async () => {
  const repoRoot = await createRepo()
  let opened = 0
  try {
    const binding = await computeTask3SourceBinding(repoRoot, {
      afterInventoryEntryOpen({ relativePath }) {
        if (relativePath === "source.mjs") opened += 1
      },
    })
    assert.equal(opened, 1)
    assert.equal(binding.manifestSha256, expectedManifestSha256)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

for (const attack of ["symlink", "hardlink", "inode", "size", "mode"]) {
  test(`source binding rejects a deterministic ${attack} swap after inventory open`, async () => {
    const repoRoot = await createRepo()
    const sourcePath = path.join(repoRoot, "source.mjs")
    const replacementPath = path.join(repoRoot, "replacement.mjs")
    try {
      await writeFile(replacementPath, "export const value = 9\n")
      await assert.rejects(
        computeTask3SourceBinding(repoRoot, {
          async afterInventoryEntryOpen({ relativePath }) {
            if (relativePath !== "source.mjs") return
            if (attack === "symlink") {
              await rm(sourcePath)
              await symlink("replacement.mjs", sourcePath)
            } else if (attack === "hardlink") {
              await rm(sourcePath)
              await link(replacementPath, sourcePath)
            } else if (attack === "inode") {
              await rename(replacementPath, sourcePath)
            } else if (attack === "size") {
              await writeFile(sourcePath, "export const changed = 'different-size'\n")
            } else {
              await chmod(sourcePath, 0o755)
            }
          },
        }),
        /inventory|changed|regular|link|mode|identity/iu,
      )
    } finally {
      await rm(repoRoot, { force: true, recursive: true })
    }
  })
}

test("source binding rejects replacement of an opened inventory parent directory", async () => {
  const repoRoot = await createRepo({ sourcePath: "nested/source.mjs" })
  const outsideRoot = await mkdtemp(path.join(tmpdir(), "spolink-task3-outside-"))
  try {
    await writeFile(path.join(outsideRoot, "source.mjs"), "export const escaped = true\n")
    await assert.rejects(
      computeTask3SourceBinding(repoRoot, {
        async afterInventoryEntryOpen({ relativePath }) {
          if (relativePath !== "nested/source.mjs") return
          await rename(path.join(repoRoot, "nested"), path.join(repoRoot, "nested-old"))
          await symlink(outsideRoot, path.join(repoRoot, "nested"))
        },
      }),
      /inventory|directory|changed|identity/iu,
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
    await rm(outsideRoot, { force: true, recursive: true })
  }
})

async function createRepo({ sourcePath = "source.mjs" } = {}) {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "spolink-task3-binding-toctou-"))
  await execFileAsync("git", ["init", "--quiet"], { cwd: repoRoot })
  await execFileAsync("git", ["config", "user.email", "binding@example.invalid"], {
    cwd: repoRoot,
  })
  await execFileAsync("git", ["config", "user.name", "Binding Test"], { cwd: repoRoot })
  await writeFile(path.join(repoRoot, "next-env.d.ts"), nextEnv(), { mode: 0o644 })
  await chmod(path.join(repoRoot, "next-env.d.ts"), 0o644)
  await mkdir(path.dirname(path.join(repoRoot, sourcePath)), { recursive: true })
  await writeFile(path.join(repoRoot, sourcePath), "export const value = 1\n")
  await execFileAsync("git", ["add", "."], { cwd: repoRoot })
  await execFileAsync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: repoRoot })
  return repoRoot
}

function nextEnv() {
  return `/// <reference types="next" />
/// <reference types="next/image-types/global" />
import "./.next/dev/types/routes.d.ts";

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
`
}
