import assert from "node:assert/strict"
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"

import {
  createFakeLifecycleRepo,
  requiredEnv,
  spawnBuffered,
  waitForFile,
} from "./fake-lifecycle-harness.mjs"
import { runBuffered, stopActiveCommand, trackActiveCommand } from "./process.mjs"

const lifecycleUrl = pathToFileURL(path.join(process.cwd(), "tests/auth-ui-e2e/lifecycle.mjs")).href

test("baseline: stopping a tracked command leaves an unrelated child running", async () => {
  const command = ["-e", "setInterval(() => {}, 1000)"]
  const ownedChild = spawnBuffered(process.execPath, command)
  const unrelatedChild = spawnBuffered(process.execPath, command)
  const tracked = trackActiveCommand({
    kill: (signal) => process.kill(ownedChild.pid, signal),
    once: () => {},
    pid: ownedChild.pid,
  })
  tracked.closed = ownedChild.result
  try {
    await stopActiveCommand(tracked)
    assert.equal((await ownedChild.result).signal, "SIGTERM")
    assert.doesNotThrow(() => process.kill(unrelatedChild.pid, 0))
  } finally {
    process.kill(unrelatedChild.pid, "SIGTERM")
    await unrelatedChild.result
  }
})

test("runBuffered force-stops an owned child that ignores SIGTERM", async () => {
  let child
  const run = runBuffered(
    process.execPath,
    ["--input-type=module", "-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
    {
      killAfterMs: 50,
      onChild: (spawned) => {
        child = spawned
      },
      timeoutMs: 50,
    },
  )
  try {
    const result = await Promise.race([
      run,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("runBuffered stayed pending")), 500),
      ),
    ])
    assert.equal(result.signal, "SIGKILL")
  } finally {
    child?.kill("SIGKILL")
  }
})

test("fake lifecycle spawnBuffered force-stops an owned child that ignores SIGTERM", async () => {
  const child = spawnBuffered(
    process.execPath,
    ["--input-type=module", "-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
    { killAfterMs: 50, timeoutMs: 50 },
  )
  try {
    const result = await Promise.race([
      child.result,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("spawnBuffered stayed pending")), 500),
      ),
    ])
    assert.equal(result.signal, "SIGKILL")
  } finally {
    await killIfStillRunning(child.pid)
  }
})

test("stopChild does not keep the runner alive after the owned child closes", async () => {
  const processModuleUrl = pathToFileURL(
    path.join(process.cwd(), "tests/auth-ui-e2e/process.mjs"),
  ).href
  const source = `
    import { spawn } from "node:child_process";
    import { stopChild } from ${JSON.stringify(processModuleUrl)};
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    await stopChild(child);
  `
  const result = await runBuffered(process.execPath, ["--input-type=module", "-e", source], {
    killAfterMs: 100,
    timeoutMs: 1_000,
  })

  assert.equal(result.exitCode, 0, "stopChild left a timer handle that blocked natural exit")
})

test("SPOLINK_AUTH_E2E_INJECT_FAILURE=after-config stops before Playwright and restores config", async () => {
  const fixture = await createFakeLifecycleRepo("spolink-auth-inject-")
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
      ...requiredEnv(),
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
    assert.equal(await readFile(fixture.configPath, "utf8"), fixture.originalConfig)
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
        ...requiredEnv(),
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
        ...requiredEnv(),
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

test("ready marker waits for tracked browser ownership and final receipt follows ordered cleanup", async () => {
  const fixture = await createFakeLifecycleRepo("spolink-auth-manifest-")
  const readyPath = path.join(fixture.repoRoot, "ready.json")
  const receiptPath = path.join(fixture.repoRoot, ".omo/evidence/cleanup.json")
  const tempPath = path.join(fixture.repoRoot, "owned-temp.txt")
  const observerPath = path.join(fixture.repoRoot, "observer-settled")
  await writeFile(tempPath, "owned\n", { mode: 0o600 })
  const source = `
    import { access, appendFile, stat, writeFile } from "node:fs/promises";
    import { withConfiguredAuthMode } from ${JSON.stringify(lifecycleUrl)};
    const log = ${JSON.stringify(fixture.logPath)};
    await withConfiguredAuthMode({
      cleanupReceiptPath: ${JSON.stringify(receiptPath)},
      cleanupTargets: {
        deleteAuthUser: async (id) => appendFile(log, "delete-auth:" + id + "\\n"),
        deleteMailpitMessage: async (id) => appendFile(log, "delete-mailpit:" + id + "\\n"),
        verifyAndDeleteProfile: async (id) => appendFile(log, "delete-profile:" + id + "\\n"),
      },
      enableConfirmations: false,
      evidencePaths: [${JSON.stringify(receiptPath)}],
      repoRoot: ${JSON.stringify(fixture.repoRoot)},
      runId: "todo2-ordered",
      tempPaths: [${JSON.stringify(tempPath)}],
    }, async ({ lifecycle }) => {
      await access(${JSON.stringify(readyPath)}).then(
        () => { throw new Error("ready marker was early") },
        () => {},
      );
      lifecycle.setIdentity({
        authUserId: "auth-exact",
        mailpitMessageIds: ["mail-exact"],
        profileId: "profile-exact",
      });
      lifecycle.trackBrowserContext(async () => appendFile(log, "browser-context-close\\n"));
      lifecycle.trackObserver(new Promise((resolve) => setTimeout(async () => {
        await appendFile(log, "observer-settled\\n");
        await writeFile(${JSON.stringify(observerPath)}, "settled\\n");
        resolve();
      }, 250)));
      const browser = lifecycle.runBrowserChild(process.execPath, ["-e", "setTimeout(() => {}, 50)"]);
      await lifecycle.ready;
      if (((await stat(${JSON.stringify(readyPath)})).mode & 0o777) !== 0o600) {
        throw new Error("ready marker mode was not 0600");
      }
      await browser;
    });
  `
  const result = await runBuffered(process.execPath, ["--input-type=module", "-e", source], {
    cwd: fixture.repoRoot,
    env: {
      ...requiredEnv(),
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH}`,
      SPOLINK_AUTH_E2E_READY_FILE: readyPath,
    },
    timeoutMs: 30_000,
  })
  try {
    assert.equal(result.exitCode, 0, result.stderr)
    await assert.rejects(() => access(readyPath), /ENOENT/)
    assert.equal((await stat(receiptPath)).mode & 0o777, 0o600)
    await access(observerPath)
    await assert.rejects(() => access(tempPath), /ENOENT/)
    const log = await readFile(fixture.logPath, "utf8")
    assertOrdered(log, [
      "browser-context-close",
      "observer-settled",
      "delete-profile:profile-exact",
      "delete-auth:auth-exact",
      "delete-mailpit:mail-exact",
      "pnpm supabase:stop",
      "pnpm supabase:assert-stopped",
    ])
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"))
    assert.equal(receipt.verdict, "APPROVE")
    assert.equal(receipt.stoppedAsserted, true)
    assert.deepEqual(receipt.shutdownOrder, ["browser", "next", "supabase"])
    assert.equal(receipt.cleanup.profile, "deleted")
    assert.equal(receipt.cleanup.authUser, "deleted")
    assert.deepEqual(receipt.cleanup.mailpitMessages, ["deleted"])
  } finally {
    await fixture.cleanup()
  }
})

test("after-next-ready fails before readiness marker or browser launch", async () => {
  const fixture = await createFakeLifecycleRepo("spolink-auth-after-next-")
  const readyPath = path.join(fixture.repoRoot, "ready.json")
  const source = `
    import { withConfiguredAuthMode } from ${JSON.stringify(lifecycleUrl)};
    await withConfiguredAuthMode(
      { enableConfirmations: false, repoRoot: ${JSON.stringify(fixture.repoRoot)} },
      async ({ lifecycle }) => lifecycle.runBrowserChild(process.execPath, ["-e", "process.exit(0)"]),
    );
  `
  const result = await runBuffered(process.execPath, ["--input-type=module", "-e", source], {
    cwd: fixture.repoRoot,
    env: {
      ...requiredEnv(),
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH}`,
      SPOLINK_AUTH_E2E_INJECT_FAILURE: "after-next-ready",
      SPOLINK_AUTH_E2E_READY_FILE: readyPath,
    },
    timeoutMs: 30_000,
  })
  try {
    assert.notEqual(result.exitCode, 0)
    await assert.rejects(() => access(readyPath), /ENOENT/)
    const log = await readFile(fixture.logPath, "utf8")
    assert.doesNotMatch(log, /playwright|process\.execPath/u)
  } finally {
    await fixture.cleanup()
  }
})

test("stale ready marker fails closed and is never overwritten", async () => {
  const fixture = await createFakeLifecycleRepo("spolink-auth-stale-ready-")
  const readyPath = path.join(fixture.repoRoot, "ready.json")
  await writeFile(readyPath, "stale-marker\n", { mode: 0o600 })
  const source = `
    import { withConfiguredAuthMode } from ${JSON.stringify(lifecycleUrl)};
    await withConfiguredAuthMode(
      { enableConfirmations: false, repoRoot: ${JSON.stringify(fixture.repoRoot)} },
      async ({ lifecycle }) => lifecycle.runBrowserChild(process.execPath, ["-e", "process.exit(0)"]),
    );
  `
  const result = await runBuffered(process.execPath, ["--input-type=module", "-e", source], {
    cwd: fixture.repoRoot,
    env: {
      ...requiredEnv(),
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH}`,
      SPOLINK_AUTH_E2E_READY_FILE: readyPath,
    },
    timeoutMs: 30_000,
  })
  try {
    assert.notEqual(result.exitCode, 0)
    assert.equal(await readFile(readyPath, "utf8"), "stale-marker\n")
    const log = await readFile(fixture.logPath, "utf8")
    assert.match(log, /pnpm supabase:stop/u)
    assert.match(log, /pnpm supabase:assert-stopped/u)
  } finally {
    await fixture.cleanup()
  }
})

test("after-mailpit-link failure cleanup is exact and idempotent", async () => {
  const fixture = await createFakeLifecycleRepo("spolink-auth-after-mailpit-")
  const receiptPath = path.join(fixture.repoRoot, ".omo/evidence/cleanup.json")
  const source = `
    import { appendFile } from "node:fs/promises";
    import { withConfiguredAuthMode } from ${JSON.stringify(lifecycleUrl)};
    const log = ${JSON.stringify(fixture.logPath)};
    await withConfiguredAuthMode({
      cleanupReceiptPath: ${JSON.stringify(receiptPath)},
      cleanupTargets: {
        deleteAuthUser: async (id) => appendFile(log, "delete-auth:" + id + "\\n"),
        deleteMailpitMessage: async (id) => appendFile(log, "delete-mailpit:" + id + "\\n"),
        verifyAndDeleteProfile: async (id) => appendFile(log, "delete-profile:" + id + "\\n"),
      },
      enableConfirmations: true,
      repoRoot: ${JSON.stringify(fixture.repoRoot)},
      runId: "todo2-mailpit",
    }, async ({ lifecycle }) => {
      lifecycle.setIdentity({ authUserId: "auth-exact", profileId: "profile-exact" });
      lifecycle.addMailpitMessageId("mail-exact");
      await lifecycle.runBrowserChild(process.execPath, ["-e", "process.exit(0)"]);
      lifecycle.reachFailurePoint("after-mailpit-link");
    });
  `
  const result = await runBuffered(process.execPath, ["--input-type=module", "-e", source], {
    cwd: fixture.repoRoot,
    env: {
      ...requiredEnv(),
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH}`,
      SPOLINK_AUTH_E2E_INJECT_FAILURE: "after-mailpit-link",
    },
    timeoutMs: 30_000,
  })
  try {
    assert.notEqual(result.exitCode, 0)
    const log = await readFile(fixture.logPath, "utf8")
    assert.equal(count(log, "delete-profile:profile-exact"), 1)
    assert.equal(count(log, "delete-auth:auth-exact"), 1)
    assert.equal(count(log, "delete-mailpit:mail-exact"), 1)
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"))
    assert.equal(receipt.verdict, "APPROVE")
  } finally {
    await fixture.cleanup()
  }
})

test("SIGTERM after ready marker stops browser then Next then Supabase and exits 143", async () => {
  const fixture = await createFakeLifecycleRepo("spolink-auth-ready-sigterm-")
  const readyPath = path.join(fixture.repoRoot, "ready.json")
  const receiptPath = path.join(fixture.repoRoot, ".omo/evidence/cleanup.json")
  const outputPath = path.join(fixture.repoRoot, ".omo/evidence/signal.json")
  const rawOutputDir = path.join(fixture.repoRoot, "raw-output")
  await mkdir(rawOutputDir, { mode: 0o700 })
  await writeFile(path.join(rawOutputDir, "block-playwright"), "block\n", { mode: 0o600 })
  const child = spawnBuffered(
    process.execPath,
    [path.join(process.cwd(), "tests/auth-ui-e2e/run-auth-forms.mjs"), outputPath],
    {
      cwd: fixture.repoRoot,
      env: {
        ...requiredEnv(),
        FAKE_BLOCK_PLAYWRIGHT: "1",
        PATH: fixture.binDir + path.delimiter + process.env.PATH,
        SPOLINK_AUTH_E2E_CLEANUP_RECEIPT_FILE: receiptPath,
        SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR: rawOutputDir,
        SPOLINK_AUTH_E2E_READY_FILE: readyPath,
      },
      timeoutMs: 30_000,
    },
  )
  try {
    await waitForFile(readyPath, 15_000)
    const browserPid = JSON.parse(await readFile(readyPath, "utf8")).browserPid
    process.kill(child.pid, "SIGTERM")
    process.kill(child.pid, "SIGTERM")
    const result = await child.result
    assert.equal(result.exitCode, 143, result.stderr)
    assert.throws(() => process.kill(browserPid, 0), /ESRCH/)
    const log = await readFile(fixture.logPath, "utf8")
    assertOrdered(log, [
      "fake next received SIGTERM",
      "pnpm supabase:stop",
      "pnpm supabase:assert-stopped",
    ])
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"))
    assert.equal(receipt.stoppedAsserted, true)
    assert.deepEqual(receipt.shutdownOrder, ["browser", "next", "supabase"])
  } finally {
    await fixture.cleanup()
  }
})

function assertOrdered(text, entries) {
  let prior = -1
  for (const entry of entries) {
    const index = text.indexOf(entry)
    assert.ok(index > prior, `${entry} must follow the prior cleanup event\n${text}`)
    prior = index
  }
}

function count(text, value) {
  return text.split(value).length - 1
}

async function stopFakeListener(listener) {
  try {
    process.kill(listener.pid, "SIGTERM")
  } catch (error) {
    if (error?.code !== "ESRCH") throw error
  }
  await listener.result
}

async function killIfStillRunning(pid) {
  try {
    process.kill(pid, "SIGKILL")
  } catch (error) {
    if (error?.code === "ESRCH") return
    throw error
  }
}
