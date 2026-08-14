import { z } from "zod"

import type { Lesson, LessonMedia } from "@/lib/home-data"
import { includesFilter } from "@/lib/lesson-search"
import {
  buildLessonReviewsResponse,
  buildLessonSchedulesResponse,
  type LessonReviewItem,
  type LessonScheduleItem,
} from "@/lib/lessons/public-lesson-subroute-api"

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const lessonListQuerySchema = z.object({
  keyword: z.string().trim().optional().default(""),
  maxPrice: z.coerce.number().int().min(0).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional().default(20),
  region: z.string().trim().optional().default(""),
  sport: z.string().trim().optional().default(""),
  sportId: z
    .string()
    .trim()
    .refine((value) => !value || uuidPattern.test(value), {
      message: "sportId must be a UUID",
    })
    .optional()
    .default(""),
  startsAfter: z
    .string()
    .trim()
    .refine((value) => !value || !Number.isNaN(Date.parse(value)), {
      message: "startsAfter must be a valid date",
    })
    .optional()
    .default(""),
})

export type LessonListQuery = z.infer<typeof lessonListQuerySchema>

export type LessonListResponse = Readonly<{
  data: readonly LessonListItem[]
  meta: Readonly<{
    page: number
    pageSize: number
    total: number
  }>
}>

export type LessonDetailResponse = Readonly<{
  data: LessonDetail
}>

export type LessonListQueryParseResult = Readonly<
  | {
      query: LessonListQuery
      status: "success"
    }
  | {
      issues: readonly string[]
      status: "failure"
    }
>

type LessonListItem = Readonly<{
  coach: Readonly<{
    displayName: string
    id: string
    ratingAverage: number | null
  }>
  durationMinutes: number
  id: string
  priceAmount: number
  region: string
  sport: Readonly<{
    id: string
    name: string
  }>
  thumbnailUrl: string | null
  title: string
}>

type LessonDetail = LessonListItem &
  Readonly<{
    cancellationPolicySummary: string
    description: string
    images: readonly LessonImageItem[]
    placeName: string
    preparation: string
    reviews: readonly LessonReviewItem[]
    schedules: readonly LessonScheduleItem[]
    summary: string
  }>

type LessonImageItem = Readonly<{
  sortOrder: number
  url: string
}>

export function parseLessonListQuery(searchParams: URLSearchParams): LessonListQueryParseResult {
  const parsedQuery = lessonListQuerySchema.safeParse(Object.fromEntries(searchParams))

  return parsedQuery.success
    ? { query: parsedQuery.data, status: "success" }
    : { issues: parsedQuery.error.issues.map((issue) => issue.message), status: "failure" }
}

export function buildLessonListResponse(
  lessons: readonly Lesson[],
  query: LessonListQuery,
): LessonListResponse {
  const filteredLessons = lessons.filter((lesson) => matchesLessonQuery(lesson, query))
  const startIndex = (query.page - 1) * query.pageSize
  const pagedLessons = filteredLessons.slice(startIndex, startIndex + query.pageSize)

  return {
    data: pagedLessons.map(mapLessonListItem),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total: filteredLessons.length,
    },
  }
}

export function buildLessonDetailResponse(lesson: Lesson): LessonDetailResponse {
  const photoUrl = getLessonPhotoUrl(lesson.media)

  return {
    data: {
      ...mapLessonListItem(lesson),
      cancellationPolicySummary: lesson.refundSummary,
      description: lesson.detailBullets.join("\n"),
      images: photoUrl ? [{ sortOrder: 0, url: photoUrl }] : [],
      placeName: lesson.venueText,
      preparation: lesson.preparationText,
      reviews: buildLessonReviewsResponse(lesson).data,
      schedules: buildLessonSchedulesResponse(lesson).data,
      summary: lesson.summary,
    },
  }
}

function matchesLessonQuery(lesson: Lesson, query: LessonListQuery) {
  const keyword = query.keyword

  return (
    includesFilter(lesson.region, query.region) &&
    matchesSportFilter(lesson, query) &&
    matchesPriceRange(lesson, query) &&
    matchesStartsAfter(lesson, query.startsAfter) &&
    (includesFilter(lesson.title, keyword) ||
      includesFilter(lesson.summary, keyword) ||
      includesFilter(lesson.detailBullets.join(" "), keyword) ||
      includesFilter(lesson.coachName, keyword))
  )
}

function mapLessonListItem(lesson: Lesson): LessonListItem {
  return {
    coach: {
      displayName: lesson.coachName,
      id: lesson.coachId,
      ratingAverage: lesson.ratingAverage,
    },
    durationMinutes: lesson.durationMinutes,
    id: lesson.id,
    priceAmount: lesson.priceAmount,
    region: lesson.region,
    sport: {
      id: lesson.sportId,
      name: lesson.sport,
    },
    thumbnailUrl: getLessonPhotoUrl(lesson.media),
    title: lesson.title,
  }
}

function getLessonPhotoUrl(media: LessonMedia): string | null {
  switch (media.kind) {
    case "photo":
      return media.src
    case "missing":
      return null
    default:
      return media satisfies never
  }
}

function matchesPriceRange(lesson: Lesson, query: LessonListQuery) {
  if (query.minPrice !== undefined && lesson.priceAmount < query.minPrice) {
    return false
  }

  if (query.maxPrice !== undefined && lesson.priceAmount > query.maxPrice) {
    return false
  }

  return true
}

function matchesSportFilter(lesson: Lesson, query: LessonListQuery) {
  if (query.sportId && lesson.sportId !== query.sportId) {
    return false
  }

  return includesFilter(lesson.sport, query.sport)
}

function matchesStartsAfter(lesson: Lesson, startsAfter: string) {
  if (!startsAfter) {
    return true
  }

  const startsAfterTime = Date.parse(startsAfter)

  return lesson.schedules.some((schedule) => {
    if (!schedule.startsAt) {
      return false
    }

    return Date.parse(schedule.startsAt) >= startsAfterTime
  })
}
