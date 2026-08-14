import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"
import { pathToFileURL } from "node:url"
import { matchesLessonSearchDate, parseKstDateRange, readFilters } from "../lib/lesson-search.ts"

const workspaceUrl = pathToFileURL(`${process.cwd()}/`).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`${specifier.slice(2)}.ts`, workspaceUrl).href, context)
    }

    return nextResolve(specifier, context)
  },
})

test("parseKstDateRange returns exact KST half-open UTC boundaries", () => {
  const range = parseKstDateRange("2026-08-15")

  assert.deepEqual(range, {
    from: "2026-08-14T15:00:00.000Z",
    toExclusive: "2026-08-15T15:00:00.000Z",
  })
})

test("readFilters normalizes malformed and nonexistent calendar dates", () => {
  for (const date of ["2026-8-15", "2026-02-29", "2026-13-01", "not-a-date", ""]) {
    assert.equal(readFilters({ date }).date, "")
  }
})

test("matchesLessonSearchDate includes KST day boundaries and rejects unavailable schedules", () => {
  const range = parseKstDateRange("2026-08-15")
  assert.ok(range)

  const cases = [
    ["KST 00:00", "2026-08-14T15:00:00.000Z", true, 1, true],
    ["KST 23:59:59", "2026-08-15T14:59:59.999Z", true, 1, true],
    ["next KST midnight", "2026-08-15T15:00:00.000Z", true, 1, false],
    ["different day", "2026-08-14T14:59:59.999Z", true, 1, false],
    ["closed", "2026-08-15T03:00:00.000Z", false, 1, false],
    ["full", "2026-08-15T03:00:00.000Z", true, 0, false],
  ]

  for (const [label, startsAt, isOpen, remainingCount, expected] of cases) {
    assert.equal(
      matchesLessonSearchDate(
        { schedules: [{ id: label, isOpen, label: "stale label", remainingCount, startsAt }] },
        range,
      ),
      expected,
      label,
    )
  }
})

test("matchesLessonSearchDate requires an explicitly open schedule with a positive finite integer remaining count", () => {
  const range = parseKstDateRange("2026-08-15")
  assert.ok(range)

  const inRangeStartsAt = "2026-08-15T03:00:00.000Z"
  const rejectedSchedules = [
    ["missing isOpen", { remainingCount: 1 }],
    ["missing remainingCount", { isOpen: true }],
    ["zero remainingCount", { isOpen: true, remainingCount: 0 }],
    ["negative remainingCount", { isOpen: true, remainingCount: -1 }],
    ["NaN remainingCount", { isOpen: true, remainingCount: Number.NaN }],
    ["infinite remainingCount", { isOpen: true, remainingCount: Number.POSITIVE_INFINITY }],
    ["fractional remainingCount", { isOpen: true, remainingCount: 1.5 }],
    ["malformed remainingCount", { isOpen: true, remainingCount: "1" }],
  ]

  for (const [label, availability] of rejectedSchedules) {
    assert.equal(
      matchesLessonSearchDate(
        {
          schedules: [
            { id: label, label: "stale label", startsAt: inRangeStartsAt, ...availability },
          ],
        },
        range,
      ),
      false,
      label,
    )
  }
})

test("search reads eligible schedule lesson IDs before applying the public lesson limit", async () => {
  const { getLessonsForSearchDisplay } = await import("../lib/lessons/display-lessons.ts")
  const calls = []
  const matchingLesson = { id: "older-than-newest-12", schedules: [], status: "active" }
  const repository = {
    configured: true,
    async readEligibleLessonIds(range) {
      calls.push(["schedules", range])
      return { status: "success", value: [matchingLesson.id] }
    },
    async readLessonsByIds(selection) {
      calls.push(["lessons", selection])
      return { status: "success", value: [matchingLesson] }
    },
  }

  const result = await getLessonsForSearchDisplay(
    { date: "2026-08-15", region: "", sport: "" },
    repository,
  )

  assert.equal(result.status, "success")
  assert.deepEqual(
    result.lessons.map((lesson) => lesson.id),
    [matchingLesson.id],
  )
  assert.equal(calls[0][0], "schedules")
  assert.deepEqual(calls[1], [
    "lessons",
    {
      dateRange: {
        from: "2026-08-14T15:00:00.000Z",
        toExclusive: "2026-08-15T15:00:00.000Z",
      },
      lessonIds: [matchingLesson.id],
      limit: 12,
    },
  ])
})

test("unconfigured demo search applies the same date matcher instead of stale fallback cards", async () => {
  const { getLessonsForSearchDisplay } = await import("../lib/lessons/display-lessons.ts")
  const repository = {
    configured: false,
    async readEligibleLessonIds() {
      throw new assert.AssertionError({ message: "unconfigured search must stay local" })
    },
    async readLessonsByIds() {
      throw new assert.AssertionError({ message: "unconfigured search must stay local" })
    },
  }

  const result = await getLessonsForSearchDisplay(
    { date: "2099-12-31", region: "", sport: "" },
    repository,
  )

  assert.deepEqual(result, { lessons: [], status: "demo" })
})

test("configured zero matches remains empty and read failure stays distinct", async () => {
  const { getLessonsForSearchDisplay } = await import("../lib/lessons/display-lessons.ts")
  const emptyRepository = {
    configured: true,
    async readEligibleLessonIds() {
      return { status: "success", value: [] }
    },
    async readLessonsByIds() {
      throw new assert.AssertionError({ message: "lesson read must not run for zero IDs" })
    },
  }
  const failureRepository = {
    configured: true,
    async readEligibleLessonIds() {
      return { status: "failure" }
    },
    async readLessonsByIds() {
      throw new assert.AssertionError({ message: "lesson read must not run after failure" })
    },
  }

  assert.deepEqual(
    await getLessonsForSearchDisplay(
      { date: "2026-08-15", region: "", sport: "" },
      emptyRepository,
    ),
    { lessons: [], status: "success" },
  )
  assert.deepEqual(
    await getLessonsForSearchDisplay(
      { date: "2026-08-15", region: "", sport: "" },
      failureRepository,
    ),
    { lessons: [], status: "failure" },
  )
})
