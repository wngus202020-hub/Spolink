import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import test from "node:test"
import { promisify } from "node:util"

import { buildLocalAppEnv } from "../../scripts/supabase-local/app-env.mjs"
import { readGuardedLocalStatus } from "../supabase-e2e/local-status.mjs"

const execFileAsync = promisify(execFile)
const expectedEnvKeys = [
  "HOME",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "PATH",
  "SPOLINK_AUTH_FLOW_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TMPDIR",
]
const syntheticHostEnv = {
  PATH: "/synthetic/bin",
  HOME: "/synthetic/home",
  TMPDIR: "/synthetic/tmp",
  UNRELATED_PARENT_VALUE: "must-not-be-inherited",
}
const parsedSyntheticStatus = {
  projectId: "spolink",
  apiUrl: "http://127.0.0.1:54321",
  anonKey: "sb_publishable_synthetic-local-anon-key",
  serviceRoleKey: "sb_secret_synthetic-local-service-key",
}

const syntheticStatus = JSON.stringify({
  API_URL: "http://127.0.0.1:54321",
  DB_URL: "postgresql://postgres:local-password@127.0.0.1:54322/postgres",
  PUBLISHABLE_KEY: "sb_publishable_synthetic-local-anon-key",
  SECRET_KEY: "sb_secret_synthetic-local-service-key",
})

test("characterizes the existing guarded local status contract with synthetic loopback data", async () => {
  // Given: a synthetic status for the expected project on loopback endpoints.
  const expected = {
    apiUrl: "http://127.0.0.1:54321",
    dbUrl: "postgresql://postgres:local-password@127.0.0.1:54322/postgres",
    anonKey: "sb_publishable_synthetic-local-anon-key",
    serviceRoleKey: "sb_secret_synthetic-local-service-key",
  }

  // When: the existing test-owned guarded status reader parses the status.
  const actual = await readGuardedLocalStatus({ statusJson: syntheticStatus, projectId: "spolink" })

  // Then: it exposes the four runtime fields and only a redacted credential projection.
  assert.deepEqual(
    {
      apiUrl: actual.apiUrl,
      dbUrl: actual.dbUrl,
      anonKey: actual.anonKey,
      serviceRoleKey: actual.serviceRoleKey,
    },
    expected,
  )
  assert.equal(actual.redacted.PUBLISHABLE_KEY, "<redacted>")
  assert.equal(actual.redacted.SECRET_KEY, "<redacted>")
})

test("builds the exact seven-key local Next environment", () => {
  // Given: validated local status data and a host env containing an unrelated value.
  // When: the local app environment is built.
  const actual = buildLocalAppEnv(parsedSyntheticStatus, syntheticHostEnv)

  // Then: only the seven allowed keys and their intended source values are returned.
  assert.deepEqual(Object.keys(actual).sort(), expectedEnvKeys)
  assert.deepEqual(
    {
      PATH: actual.PATH,
      HOME: actual.HOME,
      TMPDIR: actual.TMPDIR,
      NEXT_PUBLIC_SUPABASE_URL: actual.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: actual.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: actual.SUPABASE_SERVICE_ROLE_KEY,
    },
    {
      PATH: syntheticHostEnv.PATH,
      HOME: syntheticHostEnv.HOME,
      TMPDIR: syntheticHostEnv.TMPDIR,
      NEXT_PUBLIC_SUPABASE_URL: parsedSyntheticStatus.apiUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: parsedSyntheticStatus.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: parsedSyntheticStatus.serviceRoleKey,
    },
  )
  assert.match(actual.SPOLINK_AUTH_FLOW_SECRET, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(Buffer.from(actual.SPOLINK_AUTH_FLOW_SECRET, "base64url").length, 32)
})

test("keeps the auth-flow secret stable for the process lifetime", () => {
  // Given: two builds in this process with equivalent validated inputs.
  // When: both local app environments are created.
  const first = buildLocalAppEnv(parsedSyntheticStatus, syntheticHostEnv)
  const second = buildLocalAppEnv(parsedSyntheticStatus, syntheticHostEnv)

  // Then: the process-lifetime secret identity is stable.
  assert.equal(first.SPOLINK_AUTH_FLOW_SECRET, second.SPOLINK_AUTH_FLOW_SECRET)
})

test("uses a distinct auth-flow secret in separate processes", async () => {
  // Given: a child program that emits only a SHA-256 digest of its generated secret.
  const childProgram = `
    import { createHash } from "node:crypto";
    import { buildLocalAppEnv } from "./scripts/supabase-local/app-env.mjs";
    const status = ${JSON.stringify(parsedSyntheticStatus)};
    const hostEnv = ${JSON.stringify(syntheticHostEnv)};
    const secret = buildLocalAppEnv(status, hostEnv).SPOLINK_AUTH_FLOW_SECRET;
    process.stdout.write(createHash("sha256").update(secret).digest("hex"));
  `

  // When: two independent Node processes build the environment.
  const [first, second] = await Promise.all([
    execFileAsync(process.execPath, ["--input-type=module", "-e", childProgram]),
    execFileAsync(process.execPath, ["--input-type=module", "-e", childProgram]),
  ])

  // Then: their non-secret digests differ without asserting random exact values.
  assert.match(first.stdout, /^[a-f0-9]{64}$/)
  assert.match(second.stdout, /^[a-f0-9]{64}$/)
  assert.notEqual(first.stdout, second.stdout)
})

for (const key of ["PATH", "HOME", "TMPDIR"]) {
  test(`rejects a missing required host ${key}`, () => {
    // Given: one required host key is absent.
    const hostEnv = { ...syntheticHostEnv }
    delete hostEnv[key]

    // When/Then: app env construction fails closed.
    assert.throws(() => buildLocalAppEnv(parsedSyntheticStatus, hostEnv), /required environment/i)
  })
}

for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT", "SUPABASE_ACCESS_TOKEN"]) {
  test(`rejects unsafe inherited ${key} before local status access`, async () => {
    // Given: an unsafe provider control and a status runner that records access.
    let statusAccessCount = 0
    const env = { ...syntheticHostEnv, [key]: "synthetic-unsafe-control" }

    // When/Then: the status boundary rejects before invoking the status process.
    await assert.rejects(
      readGuardedLocalStatus({
        env,
        spawnRunner: async () => {
          statusAccessCount += 1
          return { exitCode: 0, stdout: syntheticStatus, stderr: "" }
        },
      }),
      /unsafe inherited environment/i,
    )
    assert.equal(statusAccessCount, 0)
  })
}

test("rejects malformed local status without exposing credential material", () => {
  // Given: malformed status variants containing synthetic credential material.
  const cases = [
    { ...parsedSyntheticStatus, projectId: "other-project" },
    { ...parsedSyntheticStatus, apiUrl: "https://hosted-project.supabase.co" },
    { ...parsedSyntheticStatus, anonKey: "" },
    { ...parsedSyntheticStatus, serviceRoleKey: "" },
    { ...parsedSyntheticStatus, anonKey: "<redacted>" },
    { ...parsedSyntheticStatus, serviceRoleKey: "placeholder-service-key" },
  ]

  for (const status of cases) {
    // When/Then: rejection does not echo URLs or either credential value.
    assert.throws(
      () => buildLocalAppEnv(status, syntheticHostEnv),
      (error) => {
        assert.ok(error instanceof Error)
        assert.doesNotMatch(error.message, /hosted-project\.supabase\.co/)
        for (const credential of [status.anonKey, status.serviceRoleKey]) {
          if (credential.length > 0) assert.equal(error.message.includes(credential), false)
        }
        return true
      },
    )
  }
})
