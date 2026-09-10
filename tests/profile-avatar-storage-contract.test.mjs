import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migrationPath = "supabase/migrations/20260903090000_add_profile_avatar_storage.sql"

test("profile avatar storage is public, bounded, and image-only", () => {
  // Given: the profile-avatar storage migration.
  const sql = readFileSync(migrationPath, "utf8")

  // When: the bucket contract is inspected.
  // Then: public profile media has a strict size and MIME allowlist.
  assert.match(sql, /'profile-avatars'[\s\S]*true[\s\S]*5 \* 1024 \* 1024/u)
  for (const mimeType of ["image/jpeg", "image/png", "image/webp"]) {
    assert.match(sql, new RegExp(`'${mimeType}'`, "u"))
  }
  assert.doesNotMatch(sql, /image\/svg\+xml|image\/gif/iu)
})

test("profile avatar writes stay on the authenticated owner's canonical object", () => {
  // Given: the profile-avatar storage migration.
  const sql = readFileSync(migrationPath, "utf8")

  // When: write policies are inspected.
  // Then: insert, replacement, and deletion are owner-scoped and reject restricted accounts.
  for (const operation of ["insert", "update", "delete"]) {
    assert.match(sql, new RegExp(`for ${operation} to authenticated`, "iu"))
  }
  assert.match(sql, /split_part\(name, '\/', 2\) = \(select auth\.uid\(\)\)::text/u)
  assert.match(sql, /name ~ '\^profiles\/[\s\S]*\/avatar\$'/u)
  assert.match(sql, /profiles\.deleted_at is null/u)
  assert.match(sql, /profiles\.status not in \('suspended', 'deleted'\)/u)
})
