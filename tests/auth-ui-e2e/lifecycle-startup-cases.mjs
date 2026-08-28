import assert from "node:assert/strict"
import { access, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"

import {
  createFakeLifecycleRepo,
  requiredEnv,
  spawnBuffered,
  waitForFile,
} from "./fake-lifecycle-harness.mjs"
import { runBuffered } from "./process.mjs"

const lifecycleUrl = pathToFileURL(path.join(process.cwd(), "tests/auth-ui-e2e/lifecycle.mjs")).href

test("SPOLINK_AUTH_E2E_INJECT_FAILURE=after-config stops before Playwright and restores config", async () => {
  const fixture = await createFakeLifecycleRepo("spolink-auth-inject-")
  const configBefore = await configIdentity(fixture.configPath)
  const source = `
    import { withConfiguredAuthMode } from ${JSON.stringify(lifecycleUrl)};
    await withConfiguredAuthMode(
      { enableConfirmations: false, repoRoot: ${JSON.stringify(fixture.repoRoot)} },
      async () => { throw new Error("Playwright callback must not run") },
    );
  `
  const result = await runBuffered(process.execPath, ["--input-type=module", "-e", source], {
    cwd: fixture.repoRoot,
    env: {
      ...requiredEnv(fixture.repoRoot),
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH}`,
      SPOLINK_AUTH_E2E_INJECT_FAILURE: "after-config",
    },
    timeoutMs: 30_000,
  })
  try {
    assert.notEqual(result.exitCode, 0)
    const fakeLog = await readFile(fixture.logPath, "utf8")
    assert.doesNotMatch(fakeLog, /pnpm supabase:start|pnpm exec next|pnpm exec playwright/u)
    assert.doesNotMatch(fakeLog, /pnpm supabase:stop/u)
    assert.match(fakeLog, /pnpm supabase:assert-stopped/u)
    assert.deepEqual(await configIdentity(fixture.configPath), configBefore)
    await assert.rejects(() => access(authWorkspaceFromLog(fakeLog)), /ENOENT/u)
  } finally {
    await fixture.cleanup()
  }
})

test("failed Supabase start never stops or claims an unowned external runtime", async () => {
  const fixture = await createFakeLifecycleRepo("spolink-auth-unowned-supabase-")
  const receiptPath = path.join(fixture.repoRoot, ".omo/evidence/cleanup.json")
  const externalListener = spawnBuffered(process.execPath, [
    "--input-type=module",
    "-e",
    'import http from "node:http"; http.createServer((_request, response) => response.end("external")).listen(0, "127.0.0.1");',
  ])
  await writeFile(fixture.externalMarkerPath, "externally-owned\n", { mode: 0o600 })
  await writeFile(fixture.externalPidPath, String(externalListener.pid), { mode: 0o600 })
  const source = [
    `import { withConfiguredAuthMode } from ${JSON.stringify(lifecycleUrl)};`,
    "await withConfiguredAuthMode({",
    `  cleanupReceiptPath: ${JSON.stringify(receiptPath)},`,
    "  enableConfirmations: false,",
    `  repoRoot: ${JSON.stringify(fixture.repoRoot)},`,
    '  runId: "todo2-unowned-collision",',
    '}, async () => { throw new Error("callback must not run"); });',
  ].join("\n")
  try {
    const result = await runBuffered(process.execPath, ["--input-type=module", "-e", source], {
      cwd: fixture.repoRoot,
      env: {
        ...requiredEnv(fixture.repoRoot),
        PATH: fixture.binDir + path.delimiter + process.env.PATH,
      },
      timeoutMs: 30_000,
    })

    assert.notEqual(result.exitCode, 0)
    const fakeLog = await readFile(fixture.logPath, "utf8")
    assert.match(fakeLog, /pnpm supabase:start/u)
    assert.doesNotMatch(fakeLog, /pnpm supabase:stop/u)
    assert.match(fakeLog, /pnpm supabase:assert-stopped/u)
    await access(fixture.externalMarkerPath)
    assert.doesNotThrow(() => process.kill(externalListener.pid, 0))
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"))
    assert.equal(receipt.verdict, "REJECT")
    assert.equal(receipt.stoppedAsserted, false)
    assert.deepEqual(receipt.shutdownOrder, [])
    assert.notEqual(receipt.cleanup.supabase, "stopped")
  } finally {
    await stopFakeListener(externalListener)
    await fixture.cleanup()
  }
})

test("early SIGTERM during auth config startup awaits cleanup and releases runtime lock", async () => {
  const fixture = await createFakeLifecycleRepo("spolink-auth-sigterm-")
  const child = spawnBuffered(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
        import { withConfiguredAuthMode } from ${JSON.stringify(
          pathToFileURL(path.join(process.cwd(), "tests/auth-ui-e2e/lifecycle.mjs")).href,
        )};
        await withConfiguredAuthMode(
          { enableConfirmations: false, repoRoot: ${JSON.stringify(fixture.repoRoot)} },
          async () => {}
        );
      `,
    ],
    {
      cwd: fixture.repoRoot,
      env: {
        ...requiredEnv(fixture.repoRoot),
        FAKE_BLOCK_START: "1",
        PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH}`,
      },
      timeoutMs: 30_000,
    },
  )
  const startWait = waitForFile(fixture.startPath, 5_000)
  try {
    await startWait
    process.kill(child.pid, "SIGTERM")
    const result = await child.result
    const fakeLog = await readFile(fixture.logPath, "utf8")
    assert.equal(result.exitCode, 143)
    assert.doesNotMatch(result.stderr, /Auth lifecycle cleanup failed/, fakeLog)
    assert.doesNotMatch(fakeLog, /pnpm supabase:stop/)
    assert.match(fakeLog, /pnpm supabase:assert-stopped/)
    await assert.rejects(() => readFile(fixture.lockPath, "utf8"), /ENOENT/)
    assert.equal(await readFile(fixture.configPath, "utf8"), fixture.originalConfig)
  } finally {
    await fixture.killBlockedStart()
    await fixture.cleanup()
  }
})

async function stopFakeListener(listener) {
  try {
    process.kill(listener.pid, "SIGTERM")
  } catch (error) {
    if (error?.code !== "ESRCH") throw error
  }
  await listener.result
}
async function configIdentity(filePath) {
  const stats = await stat(filePath)
  return { bytes: await readFile(filePath), ino: stats.ino, mode: stats.mode }
}

function authWorkspaceFromLog(log) {
  const line = log.split(/\r?\n/u).find((entry) => entry.includes("pnpm supabase:"))
  const match = line?.match(/^cwd=(.+) pnpm supabase:/u)
  assert.ok(match, `Auth Supabase workspace cwd missing from fake log\n${log}`)
  return match[1]
}
