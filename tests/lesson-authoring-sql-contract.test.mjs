import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationPath = "supabase/migrations/20260814020000_add_lesson_authoring_lifecycle.sql"

test("lesson and schedule mutations are approved-coach RPCs with stale and reservation protection", async () => {
  const migration = await readFile(migrationPath, "utf8")
  const hardeningMigration = await readFile(
    "supabase/migrations/20260814110000_harden_lesson_schedule_overlap_concurrency.sql",
    "utf8",
  )

  assert.match(migration, /create or replace function public\.require_approved_coach\(\)/u)
  assert.match(migration, /coach_profiles\.status = 'approved'/u)
  assert.match(migration, /profiles\.status = 'coach_approved'/u)
  assert.match(migration, /create or replace function public\.transition_lesson/u)
  assert.match(
    migration,
    /old\.status in \('draft', 'rejected'\) and new\.status = 'pending_review'/u,
  )
  assert.match(migration, /checked_expected_updated_at timestamptz/u)
  assert.match(migration, /SCHEDULE_HAS_CONFIRMED_RESERVATION/u)
  assert.match(migration, /for update/u)
  assert.match(migration, /revoke all on function public\.create_lesson_draft/u)
  assert.match(migration, /grant execute on function public\.close_lesson_schedule/u)
  assert.match(hardeningMigration, /create extension if not exists btree_gist/u)
  assert.match(hardeningMigration, /exclude using gist/u)
  assert.match(hardeningMigration, /tstzrange\(starts_at, ends_at, '\[\)'\) with &&/u)
  assert.match(
    hardeningMigration,
    /from public\.lessons[\s\S]*where id = checked_lesson_id[\s\S]*for update/u,
  )
})

test("authoring RPC input never accepts stored status, actor, owner, reserved count, or transition timestamp", async () => {
  const migration = await readFile(migrationPath, "utf8")
  const signatures = [
    ...migration.matchAll(
      /create or replace function public\.(?:create_lesson_draft|update_lesson_draft|transition_lesson|create_lesson_schedule|update_lesson_schedule|close_lesson_schedule)\(([\s\S]*?)\)\nreturns/gu,
    ),
  ]
    .map((match) => match[1] ?? "")
    .join("\n")

  assert.doesNotMatch(
    signatures,
    /checked_(?:actor|coach_profile_id|owner|reserved_count|status|updated_at)/u,
  )
  assert.match(signatures, /checked_action public\.lesson_status_action/u)
})
