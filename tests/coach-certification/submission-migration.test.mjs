import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("Given the submission migration, when inspected, then only the locking RPC owns paired state changes", async () => {
  const migration = await readFile(
    "supabase/migrations/20260813000000_submit_coach_application.sql",
    "utf8",
  )

  assert.match(migration, /create or replace function public\.submit_coach_application\(\)/u)
  assert.match(migration, /from public\.profiles[\s\S]*for update/u)
  assert.match(migration, /from public\.coach_profiles[\s\S]*for update/u)
  assert.match(migration, /update public\.coach_profiles[\s\S]*status = 'submitted'/u)
  assert.match(migration, /update public\.profiles[\s\S]*status = 'pending_coach'/u)
  assert.match(
    migration,
    /revoke (insert|update)[\s\S]*public\.coach_profiles[\s\S]*authenticated/u,
  )
  assert.match(
    migration,
    /grant execute on function public\.submit_coach_application\(\) to authenticated/u,
  )
  assert.match(migration, /storage\.objects/u)
})

test("Given direct writes are revoked, when a draft is saved, then an auth-derived RPC owns only editable fields", async () => {
  const migration = await readFile(
    "supabase/migrations/20260813010000_upsert_coach_application_draft.sql",
    "utf8",
  )

  assert.match(migration, /create or replace function public\.upsert_coach_application_draft\(/u)
  assert.match(migration, /security definer/u)
  assert.match(migration, /auth\.uid\(\)/u)
  assert.match(migration, /status not in \('draft', 'rejected'\)/u)
  assert.doesNotMatch(migration, /checked_(?:user_id|status|reviewed_by|reviewed_at)/u)
  assert.match(migration, /revoke execute[\s\S]*from public, anon/u)
  assert.match(migration, /grant execute[\s\S]*to authenticated/u)
})
