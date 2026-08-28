import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { chmod, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { createWorkspaceBinding, serializeWorkspaceBinding } from "./workspace-binding.mjs"

const execFileAsync = promisify(execFile)
const utilityPath = fileURLToPath(new URL("./workspace-binding.mjs", import.meta.url))

test("records a deterministic NUL-safe binding with ignored files excluded by Git", async () => {
  const fixture = await createFixture()
  try {
    await writeFile(path.join(fixture.root, "untracked", "z space.txt"), "z")
    await writeFile(path.join(fixture.root, "untracked", "a\nline.txt"), "line")
    await writeFile(path.join(fixture.root, "untracked", "한글.txt"), "Korean")
    await symlink("target 한글\n", path.join(fixture.root, "untracked", "link name"))
    await mkdir(path.join(fixture.root, "ignored"))
    await writeFile(path.join(fixture.root, "ignored", "secret.txt"), "ignored")

    const first = await createWorkspaceBinding(fixture.root, ".")
    const second = await createWorkspaceBinding(fixture.root, ".")
    const expectedPaths = [
      "untracked/z space.txt",
      "untracked/a\nline.txt",
      "untracked/한글.txt",
      "untracked/link name",
    ].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))

    assert.deepEqual(serializeWorkspaceBinding(first), serializeWorkspaceBinding(second))
    assert.deepEqual(
      first.untrackedManifest.entries.map((entry) => entry.path),
      expectedPaths,
    )
    assert.equal(
      first.untrackedManifest.entries.some((entry) => entry.path.startsWith("ignored/")),
      false,
    )
    assert.equal(entry(first, "untracked/link name").byteSize, Buffer.byteLength("target 한글\n"))
    assert.match(entry(first, "untracked/link name").mode, /^120[0-7]{3}$/u)
    assert.equal(first.schema, "spolink.workspace-binding")
    assert.equal(first.version, 1)
    assert.deepEqual(first.invocation, [
      "node",
      "tests/lesson-images/workspace-binding.mjs",
      "--repo",
      ".",
    ])
  } finally {
    await rm(fixture.root, { force: true, recursive: true })
  }
})

test("detects tracked diff, untracked content, mode, and symlink-target drift", async () => {
  const fixture = await createFixture()
  try {
    const mutablePath = path.join(fixture.root, "untracked", "mutable.txt")
    const linkPath = path.join(fixture.root, "untracked", "link")
    await writeFile(mutablePath, "one")
    await chmod(mutablePath, 0o600)
    await symlink("first", linkPath)
    const original = await createWorkspaceBinding(fixture.root)

    await writeFile(path.join(fixture.root, "tracked.txt"), "tracked change")
    const trackedChanged = await createWorkspaceBinding(fixture.root)
    assert.notEqual(
      trackedChanged.source.trackedDiffBinarySha256,
      original.source.trackedDiffBinarySha256,
    )
    assert.equal(
      trackedChanged.source.trackedDiffBinarySha256,
      sha256(
        await git(fixture.root, ["diff", "--binary", "--no-ext-diff", "--no-textconv", "HEAD"]),
      ),
    )
    assert.equal(
      trackedChanged.source.porcelainStatusV1ZSha256,
      sha256(await git(fixture.root, ["status", "--porcelain=v1", "-z"])),
    )

    await writeFile(mutablePath, "two")
    const contentChanged = await createWorkspaceBinding(fixture.root)
    assert.notEqual(
      contentChanged.source.untrackedManifestSha256,
      trackedChanged.source.untrackedManifestSha256,
    )

    await chmod(mutablePath, 0o755)
    const modeChanged = await createWorkspaceBinding(fixture.root)
    assert.notEqual(
      modeChanged.source.untrackedManifestSha256,
      contentChanged.source.untrackedManifestSha256,
    )
    assert.equal(entry(modeChanged, "untracked/mutable.txt").mode, "100755")

    await unlink(linkPath)
    await symlink("second target", linkPath)
    const symlinkChanged = await createWorkspaceBinding(fixture.root)
    assert.notEqual(
      symlinkChanged.source.untrackedManifestSha256,
      modeChanged.source.untrackedManifestSha256,
    )
    assert.equal(
      entry(symlinkChanged, "untracked/link").sha256,
      sha256(Buffer.from("second target")),
    )

    const firstCli = await execFileAsync(process.execPath, [utilityPath, "--repo", fixture.root], {
      encoding: "buffer",
    })
    const secondCli = await execFileAsync(process.execPath, [utilityPath, "--repo", fixture.root], {
      encoding: "buffer",
    })
    assert.deepEqual(firstCli.stdout, secondCli.stdout)
  } finally {
    await rm(fixture.root, { force: true, recursive: true })
  }
})

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "spolink-workspace-binding-"))
  await git(root, ["init", "-q"])
  await git(root, ["config", "user.email", "binding@example.invalid"])
  await git(root, ["config", "user.name", "Workspace Binding"])
  await writeFile(path.join(root, ".gitignore"), "ignored/\n")
  await writeFile(path.join(root, "tracked.txt"), "baseline")
  await git(root, ["add", ".gitignore", "tracked.txt"])
  await git(root, ["commit", "-qm", "baseline"])
  await mkdir(path.join(root, "untracked"))
  return { root }
}

function entry(binding, relativePath) {
  const found = binding.untrackedManifest.entries.find(
    (candidate) => candidate.path === relativePath,
  )
  assert.ok(found, `missing manifest entry: ${relativePath}`)
  return found
}

async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "buffer" })
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
