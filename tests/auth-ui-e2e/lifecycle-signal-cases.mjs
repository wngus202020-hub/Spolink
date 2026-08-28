import assert from "node:assert/strict"
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

import {
  createFakeLifecycleRepo,
  requiredEnv,
  spawnBuffered,
  waitForFile,
} from "./fake-lifecycle-harness.mjs"

for (const [signal, exitCode] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  test(`${signal} after ready marker stops browser then Next then Supabase`, async () => {
    const fixture = await createFakeLifecycleRepo(`spolink-auth-ready-${signal.toLowerCase()}-`)
    const configBefore = await configIdentity(fixture.configPath)
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
          ...requiredEnv(fixture.repoRoot),
          FAKE_CREATE_ROOT_CLI_TEMP: "1",
          FAKE_BLOCK_PLAYWRIGHT: "1",
          PATH: fixture.binDir + path.delimiter + process.env.PATH,
          SPOLINK_AUTH_E2E_CLEANUP_RECEIPT_FILE: receiptPath,
          SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR: rawOutputDir,
        },
        timeoutMs: 30_000,
      },
    )
    try {
      await waitForFile(fixture.playwrightPidPath, 15_000)
      const browserPid = Number(await readFile(fixture.playwrightPidPath, "utf8"))
      process.kill(child.pid, signal)
      process.kill(child.pid, signal)
      const result = await child.result
      assert.equal(result.exitCode, exitCode, result.stderr)
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
      assert.deepEqual(await configIdentity(fixture.configPath), configBefore)
      await assert.rejects(() => access(authWorkspaceFromLog(log)), /ENOENT/u)
      await assert.rejects(() => access(fixture.rootCliTempPath), /ENOENT/u)
      await assert.rejects(() => access(path.dirname(fixture.rootCliTempPath)), /ENOENT/u)
    } finally {
      await fixture.cleanup()
    }
  })
}

function assertOrdered(text, entries) {
  let prior = -1
  for (const entry of entries) {
    const index = text.indexOf(entry)
    assert.ok(index > prior, `${entry} must follow the prior cleanup event\n${text}`)
    prior = index
  }
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
