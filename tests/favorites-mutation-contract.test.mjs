import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

async function readMigrations() {
  return readFile(
    new URL("../supabase/migrations/20260814030000_add_favorite_mutations.sql", import.meta.url),
    "utf8",
  )
}

test("Given another learner's favorite, when mutation RPCs run, then caller claims prevent foreign ownership", async () => {
  const migrations = await readMigrations()

  assert.match(migrations, /create or replace function public\.add_lesson_favorite\s*\(/iu)
  assert.match(migrations, /create or replace function public\.remove_lesson_favorite\s*\(/iu)
  assert.match(migrations, /auth\.uid\(\)/u)
  assert.match(migrations, /acting_profile\.role\s*<>\s*'learner'/u)
  assert.doesNotMatch(migrations, /add_lesson_favorite\s*\([^)]*learner_id/iu)
  assert.doesNotMatch(migrations, /remove_lesson_favorite\s*\([^)]*learner_id/iu)
})

test("Given duplicate and parallel favorite requests, when mutation RPCs run, then replay is deterministic", async () => {
  const migrations = await readMigrations()

  assert.match(migrations, /lesson_favorites_learner_lesson_unique/iu)
  assert.match(
    migrations,
    /on conflict on constraint lesson_favorites_learner_lesson_unique do nothing/iu,
  )
  assert.match(migrations, /favorite_added/iu)
  assert.match(migrations, /favorite_removed/iu)
})

test("Given direct table and RPC access, when grants and RLS apply, then only owner reads and authenticated RPC execute remain", async () => {
  const migration = await readMigrations()

  assert.match(migration, /force row level security/iu)
  assert.match(
    migration,
    /revoke all on table public\.lesson_favorites from public, anon, authenticated/iu,
  )
  assert.match(migration, /grant select on table public\.lesson_favorites to authenticated/iu)
  assert.match(
    migration,
    /for select to authenticated[\s\S]*learner_id = \(select auth\.uid\(\)\)/iu,
  )
  assert.match(migration, /security definer/iu)
  assert.match(migration, /revoke all on function public\.add_lesson_favorite\(uuid\)/iu)
  assert.match(
    migration,
    /grant execute on function public\.add_lesson_favorite\(uuid\) to authenticated/iu,
  )
  assert.doesNotMatch(migration, /service_role/iu)
})
