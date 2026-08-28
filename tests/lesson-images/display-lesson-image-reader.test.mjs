import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"
import { pathToFileURL } from "node:url"

const workspaceUrl = pathToFileURL(`${process.cwd()}/`).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`${specifier.slice(2)}.ts`, workspaceUrl).href, context)
    }

    return nextResolve(specifier, context)
  },
})

const { readPublicLessonImages } = await import("../../lib/lessons/display-lesson-image-reader.ts")

test("Given no configured public client, when image rows are requested, then the reader returns an empty successful relation", async () => {
  // Given
  const previousPublicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const previousPublicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  try {
    // When
    const result = await readPublicLessonImages(["00000000-0000-4000-8000-000000000001"])

    // Then
    assert.equal(result.status, "success")
    assert.equal(result.value.size, 0)
  } finally {
    restoreEnvironment("NEXT_PUBLIC_SUPABASE_URL", previousPublicUrl)
    restoreEnvironment("NEXT_PUBLIC_SUPABASE_ANON_KEY", previousPublicKey)
  }
})

test("Given no lesson IDs, when image rows are requested, then the reader returns an empty successful relation", async () => {
  // Given
  const lessonIds = []

  // When
  const result = await readPublicLessonImages(lessonIds)

  // Then
  assert.equal(result.status, "success")
  assert.equal(result.value.size, 0)
})

function restoreEnvironment(name, value) {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}
