import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("Given local Storage config and migration, when certification limits are inspected, then bucket is private and capped", async () => {
  // Given
  const config = await readFile("supabase/config.toml", "utf8")
  const migration = await readFile(
    "supabase/migrations/20260812000000_coach_certificate_storage.sql",
    "utf8",
  )

  // When
  const storageSection = config.match(/\[storage\][\s\S]*?(?=\n\[|$)/u)?.[0]

  // Then
  assert.ok(storageSection, "Storage config must exist")
  assert.match(storageSection, /file_size_limit\s*=\s*"10MiB"/u)
  assert.match(migration, /'coach-certificates'[\s\S]*false[\s\S]*10 \* 1024 \* 1024/u)
  assert.match(migration, /array\['image\/png', 'image\/jpeg', 'application\/pdf'\]/u)
})
