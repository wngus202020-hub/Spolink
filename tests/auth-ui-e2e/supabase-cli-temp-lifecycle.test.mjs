import assert from "node:assert/strict"
import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"

import { createFakeLifecycleRepo, requiredEnv } from "./fake-lifecycle-harness.mjs"
import {
  cleanupRunnerCreatedSupabaseCliTemp,
  snapshotSupabaseCliTemp,
} from "./mypage-profile-edit-runtime-cleanup.mjs"
import { runBuffered } from "./process.mjs"

const lifecycleUrl = pathToFileURL(path.join(process.cwd(), "tests/auth-ui-e2e/lifecycle.mjs")).href

for (const failurePoint of [null, "after-config", "after-next-ready"]) {
  test(`auth lifecycle removes its root CLI marker when failure point is ${failurePoint ?? "none"}`, async () => {
    // Given: a clean repository whose isolated Supabase CLI creates metadata in the repository root.
    const fixture = await createFakeLifecycleRepo("spolink-auth-cli-temp-")
    const source = `
      import { withConfiguredAuthMode } from ${JSON.stringify(lifecycleUrl)};
      await withConfiguredAuthMode(
        { enableConfirmations: false, repoRoot: ${JSON.stringify(fixture.repoRoot)} },
        async () => undefined,
      );
    `

    // When: the lifecycle succeeds or exits through the selected forced-failure boundary.
    const result = await runBuffered(process.execPath, ["--input-type=module", "-e", source], {
      cwd: fixture.repoRoot,
      env: {
        ...requiredEnv(fixture.repoRoot),
        FAKE_CREATE_ROOT_CLI_TEMP: "1",
        PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH}`,
        ...(failurePoint ? { SPOLINK_AUTH_E2E_INJECT_FAILURE: failurePoint } : {}),
      },
      timeoutMs: 30_000,
    })

    try {
      // Then: expected exit semantics are preserved and only runner-created CLI metadata is gone.
      assert.equal(result.exitCode === 0, failurePoint === null, result.stderr)
      await assert.rejects(() => access(fixture.rootCliTempPath), /ENOENT/u)
      await assert.rejects(() => access(path.dirname(fixture.rootCliTempPath)), /ENOENT/u)
    } finally {
      await fixture.cleanup()
    }
  })
}

test("auth lifecycle preserves preexisting CLI metadata and reports an unowned extra file", async () => {
  // Given: byte-stable preexisting CLI metadata and an unrelated sibling file.
  const fixture = await createFakeLifecycleRepo("spolink-auth-cli-temp-existing-")
  const tempDir = path.dirname(fixture.rootCliTempPath)
  const extraPath = path.join(tempDir, "user-owned")
  const receiptPath = path.join(fixture.repoRoot, ".omo", "evidence", "cleanup.json")
  await mkdir(tempDir, { mode: 0o700, recursive: true })
  await writeFile(fixture.rootCliTempPath, "preexisting-marker", { mode: 0o600 })
  await writeFile(extraPath, "preexisting-extra", { mode: 0o600 })
  const source = `
    import { withConfiguredAuthMode } from ${JSON.stringify(lifecycleUrl)};
    await withConfiguredAuthMode(
      {
        cleanupReceiptPath: ${JSON.stringify(receiptPath)},
        enableConfirmations: false,
        repoRoot: ${JSON.stringify(fixture.repoRoot)},
      },
      async () => undefined,
    );
  `

  // When: lifecycle cleanup runs repeatedly through its normal finally boundary.
  const result = await runBuffered(process.execPath, ["--input-type=module", "-e", source], {
    cwd: fixture.repoRoot,
    env: {
      ...requiredEnv(fixture.repoRoot),
      FAKE_CREATE_ROOT_CLI_TEMP: "1",
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH}`,
    },
    timeoutMs: 30_000,
  })

  try {
    // Then: neither preexisting file is changed or recursively deleted.
    assert.equal(result.exitCode, 0, result.stderr)
    assert.equal(await readFile(fixture.rootCliTempPath, "utf8"), "preexisting-marker")
    assert.equal(await readFile(extraPath, "utf8"), "preexisting-extra")
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"))
    assert.deepEqual(receipt.cleanup.supabaseCliTemp.remainingEntries, ["cli-latest", "user-owned"])
  } finally {
    await fixture.cleanup()
  }
})

test("runner CLI temp cleanup is idempotent and preserves an unowned sibling", async () => {
  // Given: an absent snapshot followed by one CLI marker and one unrelated sibling.
  const fixture = await createFakeLifecycleRepo("spolink-auth-cli-temp-idempotent-")
  const snapshot = await snapshotSupabaseCliTemp(fixture.repoRoot)
  const tempDir = path.dirname(fixture.rootCliTempPath)
  const extraPath = path.join(tempDir, "user-owned")
  await mkdir(tempDir, { mode: 0o700, recursive: true })
  await writeFile(fixture.rootCliTempPath, "runner-created", { mode: 0o600 })
  await writeFile(extraPath, "preserve", { mode: 0o600 })

  try {
    // When: cleanup is invoked twice for the same ownership snapshot.
    const first = await cleanupRunnerCreatedSupabaseCliTemp(snapshot)
    const second = await cleanupRunnerCreatedSupabaseCliTemp(snapshot)

    // Then: only the exact marker is removed and both calls report the surviving sibling.
    assert.equal(first.removedMarker, true)
    assert.equal(second.removedMarker, false)
    assert.deepEqual(first.remainingEntries, ["user-owned"])
    assert.deepEqual(second.remainingEntries, ["user-owned"])
    assert.equal(await readFile(extraPath, "utf8"), "preserve")
  } finally {
    await fixture.cleanup()
  }
})
