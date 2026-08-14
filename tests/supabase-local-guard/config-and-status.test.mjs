import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

import { parseSupabaseStatus, validateLocalSupabaseStatus } from "../../scripts/supabase-local.mjs"
import { diffConfigText, parseFinalConfigText } from "../supabase-e2e/supabase-config-guard.mjs"
import { repoRoot } from "./helpers.mjs"

test("parses local status JSON, redacts keys, and rejects hosted or partial key pairs", () => {
  const status = parseSupabaseStatus(
    JSON.stringify({
      API_URL: "http://127.0.0.1:54321",
      DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnopqrstuvwxyz",
      SECRET_KEY: "sb_secret_abcdefghijklmnopqrstuvwxyz",
    }),
  )
  assert.equal(status.apiUrl.hostname, "127.0.0.1")
  assert.equal(status.clientKeyName, "PUBLISHABLE_KEY")
  assert.equal(status.redacted.PUBLISHABLE_KEY, "<redacted>")
  assert.throws(
    () =>
      parseSupabaseStatus(
        JSON.stringify({
          API_URL: "https://project.supabase.co",
          DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
          ANON_KEY: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig",
          SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig",
        }),
      ),
    /loopback/i,
  )
  assert.throws(
    () =>
      parseSupabaseStatus(
        JSON.stringify({
          API_URL: "http://localhost:54321",
          DB_URL: "postgresql://postgres:postgres@localhost:54322/postgres",
          PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnopqrstuvwxyz",
        }),
      ),
    /complete/i,
  )
})

test("validateLocalSupabaseStatus rejects a wrong project id before database operations", () => {
  assert.throws(
    () =>
      validateLocalSupabaseStatus({
        projectId: "other",
        apiUrl: new URL("http://127.0.0.1:54321"),
        dbUrl: new URL("postgresql://postgres:postgres@127.0.0.1:54322/postgres"),
      }),
    /project id/i,
  )
})

test("config guard requires exact generated three-key delta and parsed TOML project id", async () => {
  const current = await readFile(path.join(repoRoot, "supabase", "config.toml"), "utf8")
  assert.equal(parseFinalConfigText(current).project_id, "spolink")
  assert.throws(() => diffConfigText(current, current), /required config delta/i)
  const before = `
project_id = "spolink"
generated_at = 2026-07-16T00:00:00Z
[api]
enabled = true
port = 54321
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000
[db]
port = 54322
shadow_port = 54320
[db.migrations]
enabled = true
[db.seed]
enabled = true
[realtime]
enabled = true
[studio]
enabled = true
port = 54323
[local_smtp]
enabled = true
port = 54324
[storage]
enabled = true
[auth]
enabled = true
[edge_runtime]
enabled = true
[analytics]
enabled = true
port = 54327
`
  const after = before
    .replace(
      'schemas = ["public", "graphql_public"]',
      'schemas = ["public"]\nauto_expose_new_tables = true',
    )
    .replace("[db.seed]\nenabled = true", "[db.seed]\nenabled = false")
  assert.deepEqual(diffConfigText(before, after), {
    changedPaths: ["api.schemas", "api.auto_expose_new_tables", "db.seed.enabled"],
  })
  assert.throws(
    () => diffConfigText(before, after.replace("max_rows = 1000", "max_rows = 999")),
    /max_rows/,
  )
  assert.throws(
    () =>
      diffConfigText(
        before,
        after.replace(
          'extra_search_path = ["public", "extensions"]',
          'extra_search_path = ["public"]',
        ),
      ),
    /extra_search_path/,
  )
})
