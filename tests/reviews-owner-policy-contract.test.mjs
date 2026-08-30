import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const lifecycleMigrationPath = "supabase/migrations/20260814130000_add_review_lifecycle.sql"
const ownerPolicyMigrationPath =
  "supabase/migrations/20260831000000_add_owner_review_history_policy.sql"

test("current review policy exposes visible rows only and revokes direct writes", async () => {
  const sql = await readFile(lifecycleMigrationPath, "utf8")

  assert.match(
    sql,
    /create policy "reviews_public_visible_only" on public\.reviews\s+for select to anon, authenticated using \(status = 'visible'\);/iu,
  )
  assert.match(
    sql,
    /revoke insert, update, delete on table public\.reviews from public, anon, authenticated;/iu,
  )
  assert.doesNotMatch(sql, /status in \('visible',\s*'hidden'\)/iu)
})

test("forward migration adds only the authenticated owner visible-hidden read policy", async () => {
  const sql = await readFile(ownerPolicyMigrationPath, "utf8")

  assert.match(
    sql,
    /create policy "reviews_owner_visible_hidden_select" on public\.reviews\s+as permissive\s+for select\s+to authenticated\s+using \(\s*reviewer_id = \(select auth\.uid\(\)\)\s+and status in \('visible', 'hidden'\)\s*\);/iu,
  )
  assert.doesNotMatch(sql, /\b(?:grant|revoke|drop|alter)\b/iu)
  assert.doesNotMatch(sql, /\bdeleted\b/iu)
})
