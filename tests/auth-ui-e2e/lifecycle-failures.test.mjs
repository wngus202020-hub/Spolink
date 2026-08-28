import assert from "node:assert/strict"
import { access, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"

import { createFakeLifecycleRepo, requiredEnv } from "./fake-lifecycle-harness.mjs"
import { runBuffered } from "./process.mjs"
import "./lifecycle-process-cases.mjs"
import "./lifecycle-signal-cases.mjs"
import "./lifecycle-startup-cases.mjs"

const lifecycleUrl = pathToFileURL(path.join(process.cwd(), "tests/auth-ui-e2e/lifecycle.mjs")).href

test("browser readiness waits for tracked ownership and final receipt follows ordered cleanup", async () => {
  const fixture = await createFakeLifecycleRepo("spolink-auth-manifest-")
  const configBefore = await configIdentity(fixture.configPath)
  const receiptPath = path.join(fixture.repoRoot, ".omo/evidence/cleanup.json")
  const observerPath = path.join(fixture.repoRoot, "observer-settled")
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
    }, async ({ lifecycle }) => {
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
      await browser;
    });
  `
  const result = await runBuffered(process.execPath, ["--input-type=module", "-e", source], {
    cwd: fixture.repoRoot,
    env: {
      ...requiredEnv(fixture.repoRoot),
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH}`,
    },
    timeoutMs: 30_000,
  })
  try {
    assert.equal(result.exitCode, 0, result.stderr)
    assert.equal((await stat(receiptPath)).mode & 0o777, 0o600)
    await access(observerPath)
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
    assert.deepEqual(await configIdentity(fixture.configPath), configBefore)
    await assert.rejects(() => access(authWorkspaceFromLog(log)), /ENOENT/u)
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
      ...requiredEnv(fixture.repoRoot),
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH}`,
      SPOLINK_AUTH_E2E_INJECT_FAILURE: "after-next-ready",
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

test("arbitrary ready marker path is ignored and never overwritten or deleted", async () => {
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
      ...requiredEnv(fixture.repoRoot),
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH}`,
      SPOLINK_AUTH_E2E_READY_FILE: readyPath,
    },
    timeoutMs: 30_000,
  })
  try {
    assert.equal(result.exitCode, 0, result.stderr)
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
      ...requiredEnv(fixture.repoRoot),
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
