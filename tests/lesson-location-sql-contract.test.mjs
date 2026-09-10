import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationPath = "supabase/migrations/20260901090000_add_lesson_geocoded_location.sql"

test("lesson location migration stores a valid coordinate pair through approved authoring RPCs", async () => {
  const migration = (await readFile(migrationPath, "utf8")).toLowerCase()

  assert.match(migration, /lessons_location_coordinates_check/u)
  assert.match(migration, /latitude between -90 and 90/u)
  assert.match(migration, /longitude between -180 and 180/u)
  assert.match(migration, /create or replace function public\.create_lesson_draft/u)
  assert.match(migration, /checked_latitude numeric/u)
  assert.match(migration, /checked_longitude numeric/u)
  assert.match(migration, /latitude = checked_latitude/u)
  assert.match(migration, /longitude = checked_longitude/u)
  assert.match(migration, /grant execute on function public\.update_lesson_draft/u)
})
