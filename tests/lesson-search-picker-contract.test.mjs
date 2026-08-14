import assert from "node:assert/strict"
import test from "node:test"
import {
  buildLessonsHref,
  includesFilter,
  matchesLessonSearchDate,
  parseKstDateRange,
  readFilters,
} from "../lib/lesson-search.ts"

test("readFilters preserves canonical and legacy query aliases", () => {
  // Given: canonical and legacy URL query inputs.
  const canonical = { date: "2026-08-15", region: "경기도 수원시", sport: "축구" }
  const legacy = { 일정: "2026-08-16", 지역: "광주광역시 북구", 종목: "야구" }

  // When: both inputs cross the public query parser.
  const canonicalFilters = readFilters(canonical)
  const legacyFilters = readFilters(legacy)

  // Then: both produce the canonical filter shape and 전체 clears sport.
  assert.deepEqual(canonicalFilters, canonical)
  assert.deepEqual(legacyFilters, {
    date: "2026-08-16",
    region: "광주광역시 북구",
    sport: "야구",
  })
  assert.equal(readFilters({ sport: "전체" }).sport, "")
})

test("lesson href keeps date canonical and date membership uses schedule instants", () => {
  // Given: selected filters and a schedule exactly at KST midnight.
  const filters = { date: "2026-08-15", region: "경기도 수원시", sport: "축구" }
  const range = parseKstDateRange(filters.date)
  assert.ok(range)

  // When: a sport override is encoded and the schedule is matched.
  const url = new URL(buildLessonsHref(filters, "야구"), "https://spolink.test")
  const matches = matchesLessonSearchDate(
    {
      schedules: [
        {
          id: "schedule-at-kst-midnight",
          isOpen: true,
          label: "표시 문구와 무관",
          remainingCount: 1,
          startsAt: "2026-08-14T15:00:00.000Z",
        },
      ],
    },
    range,
  )

  // Then: URL values remain canonical and matching uses the instant, not display text.
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    date: "2026-08-15",
    region: "경기도 수원시",
    sport: "야구",
  })
  assert.equal(includesFilter("경기도 수원시", "경기도 수원시"), true)
  assert.equal(matches, true)
})
