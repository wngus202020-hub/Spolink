import { z } from "zod"

import type { Lesson, LessonReview, LessonSchedule } from "@/lib/home-data"

const scheduleQuerySchema = z.object({
  from: z
    .string()
    .trim()
    .refine((value) => !value || !Number.isNaN(Date.parse(value)), {
      message: "from must be a valid date",
    })
    .optional()
    .default(""),
  openOnly: z
    .string()
    .trim()
    .optional()
    .default("true")
    .refine((value) => value === "true" || value === "false", {
      message: "openOnly must be true or false",
    })
    .transform((value) => value === "true"),
  to: z
    .string()
    .trim()
    .refine((value) => !value || !Number.isNaN(Date.parse(value)), {
      message: "to must be a valid date",
    })
    .optional()
    .default(""),
})

export type LessonSchedulesQuery = z.infer<typeof scheduleQuerySchema>

export type LessonSchedulesQueryParseResult = Readonly<
  | {
      query: LessonSchedulesQuery
      status: "success"
    }
  | {
      issues: readonly string[]
      status: "failure"
    }
>

export type LessonSchedulesResponse = Readonly<{
  data: readonly LessonScheduleItem[]
}>

export type LessonReviewsResponse = Readonly<{
  data: readonly LessonReviewItem[]
}>

export type LessonScheduleItem = Readonly<{
  capacity: number | null
  id: string
  isOpen: boolean
  label: string
  remainingCount: number | null
  reservedCount: number | null
  startsAt: string | null
}>

export type LessonReviewItem = Readonly<{
  content: string | null
  createdAt: string
  id: string
  rating: number
}>

export function parseLessonSchedulesQuery(
  searchParams: URLSearchParams,
): LessonSchedulesQueryParseResult {
  const parsedQuery = scheduleQuerySchema.safeParse(Object.fromEntries(searchParams))

  return parsedQuery.success
    ? { query: parsedQuery.data, status: "success" }
    : { issues: parsedQuery.error.issues.map((issue) => issue.message), status: "failure" }
}

export function buildLessonSchedulesResponse(
  lesson: Lesson,
  query: LessonSchedulesQuery = { from: "", openOnly: true, to: "" },
): LessonSchedulesResponse {
  const startsAfter = getScheduleStartsAfter(query)

  return {
    data: lesson.schedules
      .filter((schedule) => matchesScheduleQuery(schedule, query, startsAfter))
      .map(mapScheduleItem),
  }
}

export function buildLessonReviewsResponse(lesson: Lesson): LessonReviewsResponse {
  return {
    data: lesson.reviews.map(mapReviewItem),
  }
}

function mapScheduleItem(schedule: LessonSchedule): LessonScheduleItem {
  return {
    capacity: schedule.capacity ?? null,
    id: schedule.id,
    isOpen: schedule.isOpen ?? true,
    label: schedule.label,
    remainingCount: schedule.remainingCount ?? null,
    reservedCount: schedule.reservedCount ?? null,
    startsAt: schedule.startsAt ?? null,
  }
}

function mapReviewItem(review: LessonReview): LessonReviewItem {
  return {
    content: review.content,
    createdAt: review.createdAt,
    id: review.id,
    rating: review.rating,
  }
}

function matchesScheduleQuery(
  schedule: LessonSchedule,
  query: LessonSchedulesQuery,
  startsAfter: string,
) {
  if (query.openOnly && schedule.isOpen === false) {
    return false
  }

  if (!schedule.startsAt) {
    return !startsAfter && !query.to
  }

  const startsAtTime = Date.parse(schedule.startsAt)

  if (startsAfter && startsAtTime < Date.parse(startsAfter)) {
    return false
  }

  if (query.to && startsAtTime > Date.parse(query.to)) {
    return false
  }

  return true
}

function getScheduleStartsAfter(query: LessonSchedulesQuery) {
  return query.from || (query.to ? "" : new Date().toISOString())
}
