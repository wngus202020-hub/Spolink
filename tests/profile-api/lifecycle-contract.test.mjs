import assert from "node:assert/strict"
import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"

import { createFakeLifecycleRepo, requiredEnv } from "../auth-ui-e2e/fake-lifecycle-harness.mjs"
import { runBuffered } from "../auth-ui-e2e/process.mjs"

test("Given fast API contracts pass, When the API lifecycle continues, Then it runs live profile QA serially", async () => {
  // Given: the API lifecycle source is the package-level test:api implementation.
  const source = await readFile("tests/auth-ui-e2e/lifecycle.mjs", "utf8")

  // When: its child command sequence is inspected.
  const fastIndex = source.indexOf('["pnpm", "test:api:contracts"]')
  const liveHttpIndex = source.indexOf(
    '["--test", "--test-concurrency=1", ...liveHttpApiTestFiles]',
  )
  const liveIndex = source.indexOf(
    '["--test", "--test-concurrency=1", "tests/auth-ui-e2e/profile-api.test.mjs"]',
  )

  // Then: the live Node test is a distinct serial command after the fast contracts.
  assert.notEqual(fastIndex, -1)
  assert.notEqual(liveHttpIndex, -1)
  assert.notEqual(liveIndex, -1)
  assert.equal(liveHttpIndex > fastIndex, true)
  assert.equal(liveIndex > liveHttpIndex, true)
  assert.match(source.slice(fastIndex, liveHttpIndex), /env: testEnv/u)
  assert.match(source.slice(liveHttpIndex, liveIndex), /env: testEnv/u)
  assert.match(source.slice(liveIndex), /env: testEnv/u)
  assert.match(source, /buildApiTestEnv\(process\.env, reservation\.baseUrl, status\)/u)
  assert.match(source, /const fastContracts = summarizeNodeTestRun\(result\.stdout\)/u)
  assert.match(source, /return \{[\s\S]*fastContracts,[\s\S]*liveHttpApi,[\s\S]*liveProfileApi,/u)
})

test("Given the live profile test fails, When test:api exits, Then owned cleanup still completes", async () => {
  // Given: a fake owned lifecycle whose live test fails after recording its cleanup summary.
  const fixture = await createFakeLifecycleRepo("spolink-profile-api-lifecycle-")
  const liveTestDir = path.join(fixture.repoRoot, "tests/auth-ui-e2e")
  const rootTestDir = path.join(fixture.repoRoot, "tests")
  const liveMarker = path.join(fixture.repoRoot, "live-profile-api-ran")
  await mkdir(liveTestDir, { recursive: true })
  for (const [name, count] of [
    ["payments-api.test.mjs", 10],
    ["reservations-api.test.mjs", 7],
  ]) {
    await writeFile(
      path.join(rootTestDir, name),
      `import test from "node:test"; for (let index = 0; index < ${count}; index += 1) test(\`${name} \${index}\`, () => {});\n`,
      { mode: 0o600 },
    )
  }
  await writeFile(
    path.join(liveTestDir, "profile-api.test.mjs"),
    `
      import { appendFileSync, writeFileSync } from "node:fs";
      import test from "node:test";
      test("live profile lifecycle proves canonical persistence, ownership, and cleanup", () => {
        const log = ${JSON.stringify(fixture.logPath)};
        if (!appendFileSync || !process.execArgv.includes("--test-concurrency=1")) {
          throw new Error("serial live test invocation missing");
        }
        writeFileSync(${JSON.stringify(liveMarker)}, "ran\\n");
        console.log(JSON.stringify({
          cleanup: { authUsersRemaining: 0, profileRowsRemaining: 0 },
          event: "profile-api-live-cleanup-summary",
        }));
        throw new Error("forced fake live profile failure");
      });
    `,
    { mode: 0o600 },
  )
  const lifecycleUrl = pathToFileURL(
    path.join(process.cwd(), "tests/auth-ui-e2e/lifecycle.mjs"),
  ).href
  const source = `
    import { runApiTestLifecycle } from ${JSON.stringify(lifecycleUrl)};
    await runApiTestLifecycle({ repoRoot: ${JSON.stringify(fixture.repoRoot)} });
  `

  // When: the package lifecycle is driven through its real exported entry point.
  const result = await runBuffered(process.execPath, ["--input-type=module", "-e", source], {
    cwd: fixture.repoRoot,
    env: {
      ...requiredEnv(),
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH}`,
    },
    timeoutMs: 30_000,
  })

  try {
    // Then: failure propagates, the serial live child ran, and owned cleanup remained terminal.
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /live profile API test failed/u)
    assert.match(result.stderr, /"authUsersRemaining":0/u)
    await access(liveMarker)
    const log = await readFile(fixture.logPath, "utf8")
    assert.match(log, /pnpm test:api:contracts/u)
    assert.match(log, /pnpm supabase:stop/u)
    assert.match(log, /pnpm supabase:assert-stopped/u)
    assert.equal(log.indexOf("pnpm test:api:contracts") < log.indexOf("pnpm supabase:stop"), true)
  } finally {
    await fixture.cleanup()
  }
})
