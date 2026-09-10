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

const { getActiveLessons } = await import("../lib/home-data.ts")
const { buildLessonListResponse, parseLessonListQuery } = await import(
  "../lib/lessons/public-lesson-api.ts"
)
const { selectMappableLessons } = await import("../lib/maps/lesson-map-model.ts")

test("public lesson list preserves a bounded coordinate pair for map discovery", () => {
  const query = parseLessonListQuery(new URLSearchParams())
  assert.equal(query.status, "success")
  if (query.status !== "success") return

  const response = buildLessonListResponse(getActiveLessons(), query.query)

  assert.deepEqual(
    response.data.map((lesson) => lesson.location),
    [
      { latitude: 37.5012345, longitude: 127.0312345 },
      { latitude: 37.5133, longitude: 127.1028 },
    ],
  )
})

test("map discovery excludes lessons without a complete valid coordinate pair", () => {
  const lessons = [
    lesson("valid", { latitude: 37.5, longitude: 127.03 }),
    lesson("missing", null),
    lesson("latitude-outside", { latitude: 91, longitude: 127.03 }),
    lesson("longitude-outside", { latitude: 37.5, longitude: 181 }),
  ]

  assert.deepEqual(
    selectMappableLessons(lessons).map((lesson) => lesson.id),
    ["valid"],
  )
})

function lesson(id, location) {
  return { id, location, region: "서울 강남구", title: id, venueText: `${id} 장소` }
}
