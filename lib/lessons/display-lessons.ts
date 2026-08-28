import { getActiveLessonById, getActiveLessons, type Lesson } from "@/lib/home-data"
import {
  type FilterState,
  type KstDateRange,
  matchesLessonSearchDate,
  parseKstDateRange,
} from "@/lib/lesson-search"
import { readPublicLessonImages } from "@/lib/lessons/display-lesson-image-reader"
import * as displayLessonMapper from "@/lib/lessons/display-lesson-mapper"
import type { LessonSchedulesQuery } from "@/lib/lessons/public-lesson-subroute-api"
import { createSupabasePublicReadClient } from "@/lib/supabase/public-read-client"

export type { DisplayLessonSearchResult } from "@/lib/lessons/display-lesson-mapper"

export async function getFeaturedLessonsForDisplay(): Promise<readonly Lesson[]> {
  const result = await readPublicLessons()

  return result.status === "success" && result.value.length > 0 ? result.value : getActiveLessons()
}

export async function getLessonsForSearchDisplay(
  filters: FilterState,
  repository: displayLessonMapper.DisplayLessonSearchRepository = createSearchRepository(),
): Promise<displayLessonMapper.DisplayLessonSearchResult> {
  const dateRange = parseKstDateRange(filters.date)

  if (!repository.configured) {
    const lessons = dateRange
      ? getActiveLessons().filter((lesson) => matchesLessonSearchDate(lesson, dateRange))
      : getActiveLessons()

    return { lessons, status: "demo" }
  }

  if (dateRange) {
    const eligibleLessonIds = await repository.readEligibleLessonIds(dateRange)

    if (eligibleLessonIds.status === "failure") {
      return { lessons: [], status: "failure" }
    }

    if (eligibleLessonIds.value.length === 0) {
      return { lessons: [], status: "success" }
    }

    return displayLessonMapper.toSearchResult(
      await repository.readLessonsByIds({
        dateRange,
        lessonIds: eligibleLessonIds.value,
        limit: 12,
      }),
    )
  }

  return displayLessonMapper.toSearchResult(await repository.readLessonsByIds({ limit: 12 }))
}

export async function getActiveLessonsForDisplay(): Promise<readonly Lesson[]> {
  const lessons = await getFeaturedLessonsForDisplay()

  return lessons.filter((lesson) => lesson.status === "active")
}

export async function getActiveLessonByIdForDisplay(
  lessonId: string,
  options: Readonly<{ scheduleQuery?: LessonSchedulesQuery }> = {},
): Promise<Lesson | undefined> {
  const supabaseLesson = await readPublicLessonById(lessonId, options)

  return supabaseLesson ?? getActiveLessonById(lessonId)
}

async function readPublicLessonById(
  lessonId: string,
  options: Readonly<{ scheduleQuery?: LessonSchedulesQuery }> = {},
): Promise<Lesson | undefined> {
  const readOptions: displayLessonMapper.DisplayLessonReadOptions = options.scheduleQuery
    ? { lessonId, limit: 1, scheduleQuery: options.scheduleQuery }
    : { lessonId, limit: 1 }
  const lessons = await readPublicLessons(readOptions)

  return lessons.status === "success" ? lessons.value.at(0) : undefined
}

async function readPublicLessons(
  options: displayLessonMapper.DisplayLessonReadOptions = {},
): Promise<displayLessonMapper.ReadResult<readonly Lesson[]>> {
  const supabase = createSupabasePublicReadClient()

  if (!supabase) return displayLessonMapper.failure()

  let lessonQuery = supabase
    .from("lessons")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 12)

  if (options.lessonIds) {
    lessonQuery = lessonQuery.in("id", [...options.lessonIds])
  }

  const { data: lessonRows, error: lessonError } = options.lessonId
    ? await lessonQuery.eq("id", options.lessonId)
    : await lessonQuery

  if (lessonError) return displayLessonMapper.failure()

  if (lessonRows.length === 0) return displayLessonMapper.success([])

  const lessonIds = lessonRows.map((lesson) => lesson.id)
  const sportIds = lessonRows.map((lesson) => lesson.sport_id)
  const coachProfileIds = lessonRows.map((lesson) => lesson.coach_profile_id)
  const publicScheduleRowsPromise = readSchedules(lessonIds)
  const responseScheduleRowsPromise =
    options.scheduleQuery || options.dateRange
      ? readSchedules(lessonIds, options.scheduleQuery, options.dateRange)
      : publicScheduleRowsPromise
  const [imageRows, publicScheduleRows, responseScheduleRows, reviewRows, sportRows, coachCards] =
    await Promise.all([
      readPublicLessonImages(lessonIds),
      publicScheduleRowsPromise,
      responseScheduleRowsPromise,
      readReviews(lessonIds),
      readSports(sportIds),
      readCoachCards(coachProfileIds),
    ])

  if (
    imageRows.status === "failure" ||
    publicScheduleRows.status === "failure" ||
    responseScheduleRows.status === "failure" ||
    reviewRows.status === "failure" ||
    sportRows.status === "failure" ||
    coachCards.status === "failure"
  ) {
    return displayLessonMapper.failure()
  }

  const publicLessons = lessonRows.filter((lesson) =>
    displayLessonMapper.hasRequiredPublicRelations(lesson, {
      coachCards: coachCards.value,
      schedules: publicScheduleRows.value,
      sports: sportRows.value,
    }),
  )

  return displayLessonMapper.success(
    publicLessons.map((lesson) =>
      displayLessonMapper.mapPublicLesson(lesson, {
        coachCard: coachCards.value.get(lesson.coach_profile_id),
        images: imageRows.value.get(lesson.id) ?? [],
        reviews: reviewRows.value.get(lesson.id) ?? [],
        schedules: responseScheduleRows.value.get(lesson.id) ?? [],
        sport: sportRows.value.get(lesson.sport_id),
      }),
    ),
  )
}

async function readEligibleLessonIds(range: KstDateRange) {
  const supabase = createSupabasePublicReadClient()

  if (!supabase) return displayLessonMapper.failure()

  const { data, error } = await supabase
    .from("lesson_schedules")
    .select("*")
    .eq("is_open", true)
    .gte("starts_at", range.from)
    .lt("starts_at", range.toExclusive)
    .order("starts_at", { ascending: true })

  if (error || !data) return displayLessonMapper.failure()

  return displayLessonMapper.success([
    ...new Set(
      data.filter(displayLessonMapper.hasRemainingCapacity).map((schedule) => schedule.lesson_id),
    ),
  ])
}

async function readSchedules(
  lessonIds: readonly string[],
  query?: LessonSchedulesQuery,
  dateRange?: KstDateRange,
) {
  const supabase = createSupabasePublicReadClient()

  if (!supabase || lessonIds.length === 0) {
    return displayLessonMapper.success(
      new Map<string, readonly displayLessonMapper.PublicLessonScheduleRow[]>(),
    )
  }

  let scheduleQuery = supabase
    .from("lesson_schedules")
    .select("*")
    .in("lesson_id", [...lessonIds])
    .order("starts_at", { ascending: true })

  if (query?.openOnly ?? true) {
    scheduleQuery = scheduleQuery.eq("is_open", true)
  }

  if (dateRange) {
    scheduleQuery = scheduleQuery
      .gte("starts_at", dateRange.from)
      .lt("starts_at", dateRange.toExclusive)
  } else if (query?.from) {
    scheduleQuery = scheduleQuery.gte("starts_at", query.from)
  } else if (!query?.to) {
    scheduleQuery = scheduleQuery.gt("starts_at", new Date().toISOString())
  }

  if (query?.to) {
    scheduleQuery = scheduleQuery.lte("starts_at", query.to)
  }

  const { data, error } = await scheduleQuery

  if (error || !data) return displayLessonMapper.failure()

  const scheduleRows =
    query?.openOnly === false ? data : data.filter(displayLessonMapper.hasRemainingCapacity)

  return displayLessonMapper.success(displayLessonMapper.groupByLessonId(scheduleRows))
}

async function readReviews(lessonIds: readonly string[]) {
  const supabase = createSupabasePublicReadClient()

  if (!supabase || lessonIds.length === 0) {
    return displayLessonMapper.success(
      new Map<string, readonly displayLessonMapper.PublicReviewRow[]>(),
    )
  }

  const { data, error } = await supabase
    .from("reviews")
    .select("*")
    .in("lesson_id", [...lessonIds])
    .eq("status", "visible")
    .order("created_at", { ascending: false })

  return error
    ? displayLessonMapper.failure()
    : displayLessonMapper.success(displayLessonMapper.groupByLessonId(data))
}

async function readSports(sportIds: readonly string[]) {
  const supabase = createSupabasePublicReadClient()

  if (!supabase || sportIds.length === 0) {
    return displayLessonMapper.success(new Map<string, displayLessonMapper.PublicSportRow>())
  }

  const { data, error } = await supabase
    .from("sports")
    .select("*")
    .in("id", [...sportIds])

  return error
    ? displayLessonMapper.failure()
    : displayLessonMapper.success(new Map(data.map((sport) => [sport.id, sport])))
}

async function readCoachCards(coachProfileIds: readonly string[]) {
  const supabase = createSupabasePublicReadClient()

  if (!supabase || coachProfileIds.length === 0) {
    return displayLessonMapper.success(new Map<string, displayLessonMapper.PublicCoachCardRow>())
  }

  const { data, error } = await supabase
    .from("coach_profile_public_cards")
    .select("*")
    .in("id", [...coachProfileIds])

  return error
    ? displayLessonMapper.failure()
    : displayLessonMapper.success(new Map(data.map((coachCard) => [coachCard.id, coachCard])))
}

function createSearchRepository(): displayLessonMapper.DisplayLessonSearchRepository {
  return {
    configured: createSupabasePublicReadClient() !== undefined,
    readEligibleLessonIds,
    readLessonsByIds: (selection) => readPublicLessons(selection),
  }
}
