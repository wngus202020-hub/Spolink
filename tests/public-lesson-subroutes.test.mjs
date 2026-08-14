import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"

const baseUrl = process.env.SPOLINK_TEST_BASE_URL ?? "http://127.0.0.1:3006"
const shouldUseHttp = process.env.SPOLINK_TEST_BASE_URL !== undefined
const zodModuleUrl = import.meta.resolve("zod")

test("home data exports stable demo lessons and selectors", async () => {
  // Given: the current demo lesson module loaded as plain TypeScript data.
  const { featuredLessons, getActiveLessonById, getActiveLessons, getLessonById, trustMetrics } =
    await loadHomeDataModule()

  // When: callers read exported values and selector results.
  // Then: the public module contract stays stable for home and lesson screens.
  assert.deepEqual(trustMetrics, [
    { label: "지도자 인증", value: "필수 심사" },
    { label: "예약 흐름", value: "결제 후 확정" },
    { label: "환불 기준", value: "시간별 고지" },
  ])
  assert.deepEqual(
    featuredLessons.map((lesson) => lesson.id),
    ["tennis-gangnam", "pilates-songpa", "running-mapo"],
  )
  assert.deepEqual(
    getActiveLessons().map((lesson) => lesson.id),
    ["tennis-gangnam", "pilates-songpa"],
  )
  assert.equal(getLessonById("running-mapo")?.status, "pending_review")
  assert.equal(getActiveLessonById("running-mapo"), undefined)
})

test("public lesson schedules support filters and bounded errors", async () => {
  const schedules = await getJson("/api/lessons/tennis-gangnam/schedules")
  assert.equal(schedules.status, 200)
  assert.ok(
    schedules.body.data.length > 0,
    "expected demo lesson to expose future schedules under the real system clock",
  )
  assert.deepEqual(
    schedules.body.data.map((schedule) => schedule.id),
    ["tennis-gangnam-today", "tennis-gangnam-thu", "tennis-gangnam-sat"],
  )
  assertSchedulesStartAfterNow(schedules.body.data)
  assert.deepEqual(Object.keys(schedules.body.data[0]).sort(), [
    "capacity",
    "id",
    "isOpen",
    "label",
    "remainingCount",
    "reservedCount",
    "startsAt",
  ])

  const fromBoundary = schedules.body.data[1].startsAt
  const fromFiltered = await getJson(
    `/api/lessons/tennis-gangnam/schedules?from=${encodeURIComponent(fromBoundary)}`,
  )
  assert.equal(fromFiltered.status, 200)
  assert.deepEqual(
    fromFiltered.body.data.map((schedule) => schedule.id),
    ["tennis-gangnam-thu", "tennis-gangnam-sat"],
  )

  const toBoundary = schedules.body.data[0].startsAt
  const toFiltered = await getJson(
    `/api/lessons/tennis-gangnam/schedules?to=${encodeURIComponent(toBoundary)}`,
  )
  assert.equal(toFiltered.status, 200)
  assert.deepEqual(
    toFiltered.body.data.map((schedule) => schedule.id),
    ["tennis-gangnam-today"],
  )

  const invalidDate = await getJson("/api/lessons/tennis-gangnam/schedules?from=bad-date")
  assert.equal(invalidDate.status, 400)
  assert.deepEqual(invalidDate.body, {
    error: "Invalid lesson schedules query",
    issues: ["from must be a valid date"],
  })

  const invalidOpenOnly = await getJson("/api/lessons/tennis-gangnam/schedules?openOnly=maybe")
  assert.equal(invalidOpenOnly.status, 400)
  assert.deepEqual(invalidOpenOnly.body, {
    error: "Invalid lesson schedules query",
    issues: ["openOnly must be true or false"],
  })

  const openOnlyFalse = await getJson("/api/lessons/tennis-gangnam/schedules?openOnly=false")
  assert.equal(openOnlyFalse.status, 200)
  assertSchedulesStartAfterNow(openOnlyFalse.body.data)
  assert.deepEqual(
    openOnlyFalse.body.data.map((schedule) => schedule.id),
    ["tennis-gangnam-today", "tennis-gangnam-thu", "tennis-gangnam-sat", "tennis-gangnam-closed"],
  )
  assert.equal(
    openOnlyFalse.body.data.find((schedule) => schedule.id === "tennis-gangnam-closed")?.isOpen,
    false,
  )

  const emptyFilter = await getJson(
    `/api/lessons/tennis-gangnam/schedules?from=${encodeURIComponent(
      afterLastStartsAt(openOnlyFalse.body.data),
    )}`,
  )
  assert.equal(emptyFilter.status, 200)
  assert.deepEqual(emptyFilter.body, { data: [] })
})

test("public lesson reviews expose visible review records only", async () => {
  const reviews = await getJson("/api/lessons/tennis-gangnam/reviews")
  assert.equal(reviews.status, 200)
  assert.deepEqual(Object.keys(reviews.body.data[0]).sort(), [
    "content",
    "createdAt",
    "id",
    "rating",
  ])
  assert.equal(reviews.body.data[0].id, "00000000-0000-4000-8000-000000000301")

  const missingSchedules = await getJson("/api/lessons/missing-lesson/schedules")
  assert.equal(missingSchedules.status, 404)
  assert.deepEqual(missingSchedules.body, { error: "Lesson not found" })

  const missingReviews = await getJson("/api/lessons/missing-lesson/reviews")
  assert.equal(missingReviews.status, 404)
  assert.deepEqual(missingReviews.body, { error: "Lesson not found" })
})

test("detail response uses the same schedules and reviews collections", async () => {
  const detail = await getJson("/api/lessons/tennis-gangnam")
  const schedules = await getJson("/api/lessons/tennis-gangnam/schedules")
  const reviews = await getJson("/api/lessons/tennis-gangnam/reviews")

  assert.equal(detail.status, 200)
  assert.equal(detail.body.data.schedules.length, schedules.body.data.length)
  assert.equal(detail.body.data.reviews.length, reviews.body.data.length)
})

test("demo lesson schedules are stable plain data in a fresh process", async () => {
  // Given: the current demo lesson modules loaded in a fresh Node process.
  const schedules = await loadDemoScheduleSnapshotInFreshProcess()

  // When: every schedule startsAt value is read repeatedly from the imported data.
  // Then: the snapshot is plain value data, stable on repeated reads, and future under the real clock.
  assert.ok(schedules.length > 0)
  assert.ok(schedules.every((schedule) => schedule.descriptorKind === "value"))
  assert.ok(schedules.every((schedule) => new Set(schedule.reads).size === 1))
  assert.ok(schedules.every((schedule) => Date.parse(schedule.reads[0]) > Date.now()))
})

async function getJson(path) {
  if (!shouldUseHttp) {
    return getLocalJson(path)
  }

  const response = await fetch(`${baseUrl}${path}`)
  return {
    body: await response.json(),
    status: response.status,
  }
}

async function getLocalJson(path) {
  const localApi = await loadLocalPublicLessonApi()
  const url = new URL(path, baseUrl)
  const route = matchLessonRoute(url.pathname)

  if (!route) {
    return { body: { error: "Not found" }, status: 404 }
  }

  const lesson = localApi.getActiveLessonById(route.lessonId)

  if (!lesson) {
    return { body: { error: "Lesson not found" }, status: 404 }
  }

  if (route.kind === "schedules") {
    const parsedQuery = localApi.parseLessonSchedulesQuery(url.searchParams)

    if (parsedQuery.status === "failure") {
      return {
        body: { error: "Invalid lesson schedules query", issues: parsedQuery.issues },
        status: 400,
      }
    }

    return { body: localApi.buildLessonSchedulesResponse(lesson, parsedQuery.query), status: 200 }
  }

  if (route.kind === "reviews") {
    return { body: localApi.buildLessonReviewsResponse(lesson), status: 200 }
  }

  return { body: localApi.buildLessonDetailResponse(lesson), status: 200 }
}

function matchLessonRoute(pathname) {
  const match = /^\/api\/lessons\/([^/]+)(?:\/(schedules|reviews))?$/.exec(pathname)

  if (!match) {
    return undefined
  }

  return {
    kind: match[2] ?? "detail",
    lessonId: decodeURIComponent(match[1]),
  }
}

function assertSchedulesStartAfterNow(schedules) {
  const now = Date.now()

  assert.ok(schedules.every((schedule) => Date.parse(schedule.startsAt) > now))
}

function afterLastStartsAt(schedules) {
  const lastStartsAt = schedules
    .map((schedule) => Date.parse(schedule.startsAt))
    .sort((left, right) => left - right)
    .at(-1)

  assert.notEqual(lastStartsAt, undefined)
  assert.equal(Number.isNaN(lastStartsAt), false)

  return new Date(lastStartsAt + 60_000).toISOString()
}

async function loadDemoScheduleSnapshotInFreshProcess() {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "spolink-demo-schedules-"))

  try {
    const scheduleModulePath = join(temporaryDirectory, "demo-schedule-dates.ts")
    const homeDataModulePath = join(temporaryDirectory, "home-data.ts")
    const homeDataTypesModulePath = join(temporaryDirectory, "home-data-types.ts")
    const [scheduleModuleSource, homeDataModuleSource, homeDataTypesModuleSource] =
      await Promise.all([
        readFile("lib/demo-schedule-dates.ts", "utf8"),
        readFile("lib/home-data.ts", "utf8"),
        readFile("lib/home-data-types.ts", "utf8"),
      ])

    writeFileSync(scheduleModulePath, scheduleModuleSource)
    writeFileSync(homeDataTypesModulePath, homeDataTypesModuleSource)
    writeFileSync(homeDataModulePath, rewriteHomeDataImports(homeDataModuleSource))

    return JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `
            const { featuredLessons } = await import(process.argv[1])
            const schedules = featuredLessons.flatMap((lesson) =>
              lesson.schedules.map((schedule) => {
                const descriptor = Object.getOwnPropertyDescriptor(schedule, "startsAt")
                return {
                  descriptorKind: descriptor?.value === schedule.startsAt ? "value" : "accessor",
                  id: schedule.id,
                  lessonId: lesson.id,
                  reads: [schedule.startsAt, schedule.startsAt, schedule.startsAt],
                }
              }),
            )
            console.log(JSON.stringify(schedules))
          `,
          pathToFileURL(homeDataModulePath).href,
        ],
        { encoding: "utf8" },
      ),
    )
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true })
  }
}

let homeDataModulePromise
let localPublicLessonApiPromise

async function loadHomeDataModule() {
  homeDataModulePromise ??= importTemporaryModules([
    {
      sourcePath: "lib/demo-schedule-dates.ts",
      temporaryName: "demo-schedule-dates.ts",
    },
    {
      rewrite: rewriteHomeDataImports,
      sourcePath: "lib/home-data.ts",
      temporaryName: "home-data.ts",
    },
    {
      sourcePath: "lib/home-data-types.ts",
      temporaryName: "home-data-types.ts",
    },
  ]).then(async (temporaryModules) => {
    try {
      return await temporaryModules.importModule("home-data.ts")
    } finally {
      temporaryModules.cleanup()
    }
  })

  return homeDataModulePromise
}

async function loadLocalPublicLessonApi() {
  localPublicLessonApiPromise ??= importTemporaryModules([
    {
      sourcePath: "lib/demo-schedule-dates.ts",
      temporaryName: "demo-schedule-dates.ts",
    },
    {
      rewrite: rewriteHomeDataImports,
      sourcePath: "lib/home-data.ts",
      temporaryName: "home-data.ts",
    },
    {
      sourcePath: "lib/home-data-types.ts",
      temporaryName: "home-data-types.ts",
    },
    {
      sourcePath: "lib/lesson-search.ts",
      temporaryName: "lesson-search.ts",
    },
    {
      rewrite: rewritePublicLessonSubrouteApiImports,
      sourcePath: "lib/lessons/public-lesson-subroute-api.ts",
      temporaryName: "public-lesson-subroute-api.ts",
    },
    {
      rewrite: rewritePublicLessonApiImports,
      sourcePath: "lib/lessons/public-lesson-api.ts",
      temporaryName: "public-lesson-api.ts",
    },
  ]).then(async (temporaryModules) => {
    try {
      const homeData = await temporaryModules.importModule("home-data.ts")
      const subrouteApi = await temporaryModules.importModule("public-lesson-subroute-api.ts")
      const publicLessonApi = await temporaryModules.importModule("public-lesson-api.ts")

      return {
        buildLessonDetailResponse: publicLessonApi.buildLessonDetailResponse,
        buildLessonReviewsResponse: subrouteApi.buildLessonReviewsResponse,
        buildLessonSchedulesResponse: subrouteApi.buildLessonSchedulesResponse,
        getActiveLessonById: homeData.getActiveLessonById,
        parseLessonSchedulesQuery: subrouteApi.parseLessonSchedulesQuery,
      }
    } finally {
      temporaryModules.cleanup()
    }
  })

  return localPublicLessonApiPromise
}

async function importTemporaryModules(moduleFiles) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "spolink-public-lessons-"))

  for (const moduleFile of moduleFiles) {
    const source = await readFile(moduleFile.sourcePath, "utf8")
    const rewrittenSource = moduleFile.rewrite ? moduleFile.rewrite(source) : source
    writeFileSync(join(temporaryDirectory, moduleFile.temporaryName), rewrittenSource)
  }

  return {
    cleanup: () => rmSync(temporaryDirectory, { force: true, recursive: true }),
    importModule: (temporaryName) =>
      import(pathToFileURL(join(temporaryDirectory, temporaryName)).href),
  }
}

function rewriteHomeDataImports(source) {
  return source
    .replaceAll("@/lib/demo-schedule-dates", "./demo-schedule-dates.ts")
    .replaceAll("@/lib/home-data-types", "./home-data-types.ts")
}

function rewritePublicLessonApiImports(source) {
  return source
    .replaceAll('from "zod"', `from "${zodModuleUrl}"`)
    .replaceAll("@/lib/home-data", "./home-data.ts")
    .replaceAll("@/lib/lesson-search", "./lesson-search.ts")
    .replaceAll("@/lib/lessons/public-lesson-subroute-api", "./public-lesson-subroute-api.ts")
}

function rewritePublicLessonSubrouteApiImports(source) {
  return source
    .replaceAll('from "zod"', `from "${zodModuleUrl}"`)
    .replaceAll("@/lib/home-data", "./home-data.ts")
}
