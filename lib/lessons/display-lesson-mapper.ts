import type { Lesson, LessonMedia, LessonMediaImage } from "@/lib/home-data"
import type { KstDateRange } from "@/lib/lesson-search"
import type { LessonSchedulesQuery } from "@/lib/lessons/public-lesson-subroute-api"
import type { Database } from "@/lib/supabase/database.types"
import { getSupabasePublicStorageUrl } from "@/lib/supabase/public-read-client"

export type PublicLessonImageRow = Database["public"]["Tables"]["lesson_images"]["Row"]
export type PublicLessonRow = Database["public"]["Tables"]["lessons"]["Row"]
export type PublicLessonScheduleRow = Database["public"]["Tables"]["lesson_schedules"]["Row"]
export type PublicReviewRow = Database["public"]["Tables"]["reviews"]["Row"]
export type PublicSportRow = Database["public"]["Tables"]["sports"]["Row"]
export type PublicCoachCardRow = Database["public"]["Views"]["coach_profile_public_cards"]["Row"]

export type ReadResult<Value> = Readonly<
  | {
      status: "success"
      value: Value
    }
  | {
      status: "failure"
    }
>

export type DisplayLessonSearchResult = Readonly<{
  lessons: readonly Lesson[]
  status: "demo" | "failure" | "success"
}>

export type DisplayLessonReadOptions = Readonly<{
  dateRange?: KstDateRange
  lessonId?: string
  lessonIds?: readonly string[]
  limit?: number
  scheduleQuery?: LessonSchedulesQuery
}>

export type DisplayLessonSelection = Readonly<{
  dateRange?: KstDateRange
  lessonIds?: readonly string[]
  limit: number
}>

export type DisplayLessonSearchRepository = Readonly<{
  configured: boolean
  readEligibleLessonIds: (range: KstDateRange) => Promise<ReadResult<readonly string[]>>
  readLessonsByIds: (selection: DisplayLessonSelection) => Promise<ReadResult<readonly Lesson[]>>
}>

const currencyFormatter = new Intl.NumberFormat("ko-KR")
const scheduleFormatter = new Intl.DateTimeFormat("ko-KR", {
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
  weekday: "short",
})

export function mapPublicLesson(
  lesson: PublicLessonRow,
  related: Readonly<{
    coachCard: PublicCoachCardRow | undefined
    images: readonly PublicLessonImageRow[]
    reviews: readonly PublicReviewRow[]
    schedules: readonly PublicLessonScheduleRow[]
    sport: PublicSportRow | undefined
  }>,
): Lesson {
  const sportName = related.sport?.name ?? "스포츠"
  const schedules = related.schedules.map((schedule) => ({
    capacity: schedule.capacity,
    capacityText: formatCapacity(schedule),
    id: schedule.id,
    isOpen: schedule.is_open,
    label: formatScheduleLabel(schedule.starts_at),
    remainingCount: getRemainingCapacity(schedule),
    reservedCount: schedule.reserved_count,
    startsAt: schedule.starts_at,
  }))
  const firstSchedule = schedules.at(0)
  const reviewStats = getReviewStats(related.reviews)
  const images = mapPublicLessonImages(related.images)
  const media: LessonMedia = images[0]
    ? { images, kind: "photo", src: images[0].url }
    : { kind: "missing" }

  return {
    capacityText: firstSchedule?.capacityText ?? "일정 확인 필요",
    coachId: lesson.coach_profile_id,
    coachExperienceText: formatCoachExperience(related.coachCard),
    coachName: "인증 지도자",
    coachProfileText:
      related.coachCard?.bio ?? related.coachCard?.headline ?? "인증 지도자 공개 프로필이에요.",
    detailBullets: buildDetailBullets(lesson),
    durationMinutes: lesson.duration_minutes,
    durationText: `${lesson.duration_minutes}분`,
    id: lesson.id,
    media,
    preparationText: lesson.preparation ?? "예약 후 준비물을 확인해요.",
    priceAmount: lesson.price_amount,
    priceText: `${currencyFormatter.format(lesson.price_amount)}원`,
    ratingAverage: reviewStats.average,
    ratingText: formatRatingText(reviewStats),
    refundSummary: lesson.cancellation_policy_summary ?? "예약 단계에서 환불 기준 확인",
    region: lesson.region,
    reviewSummary: formatReviewSummary(reviewStats),
    reviews: related.reviews.map(mapReview),
    scheduleText: firstSchedule?.label ?? "일정 확인 필요",
    schedules,
    sportId: lesson.sport_id,
    sport: sportName,
    status: "active",
    summary: lesson.summary ?? lesson.description,
    title: lesson.title,
    venueText: lesson.place_name ?? lesson.address ?? lesson.region,
  }
}

export function hasRequiredPublicRelations(
  lesson: PublicLessonRow,
  related: Readonly<{
    coachCards: ReadonlyMap<string, PublicCoachCardRow>
    schedules: ReadonlyMap<string, readonly PublicLessonScheduleRow[]>
    sports: ReadonlyMap<string, PublicSportRow>
  }>,
) {
  return (
    related.coachCards.has(lesson.coach_profile_id) &&
    related.sports.has(lesson.sport_id) &&
    (related.schedules.get(lesson.id)?.length ?? 0) > 0
  )
}

export function groupByLessonId<Row extends Readonly<{ lesson_id: string }>>(rows: readonly Row[]) {
  const groupedRows = new Map<string, Row[]>()

  for (const row of rows) {
    groupedRows.set(row.lesson_id, [...(groupedRows.get(row.lesson_id) ?? []), row])
  }

  return groupedRows
}

export function hasRemainingCapacity(schedule: PublicLessonScheduleRow) {
  return schedule.reserved_count < schedule.capacity
}

export function toSearchResult(result: ReadResult<readonly Lesson[]>): DisplayLessonSearchResult {
  return result.status === "success"
    ? { lessons: result.value, status: "success" }
    : { lessons: [], status: "failure" }
}

export function success<Value>(value: Value): ReadResult<Value> {
  return { status: "success", value }
}

export function failure(): ReadResult<never> {
  return { status: "failure" }
}

function mapReview(review: PublicReviewRow) {
  return {
    content: review.content,
    createdAt: review.created_at,
    id: review.id,
    rating: review.rating,
  }
}

function formatCapacity(schedule: PublicLessonScheduleRow) {
  const remaining = getRemainingCapacity(schedule)

  if (remaining <= 0) {
    return "마감"
  }

  return `${remaining}자리 남음`
}

function getRemainingCapacity(schedule: PublicLessonScheduleRow) {
  return Math.max(schedule.capacity - schedule.reserved_count, 0)
}

function formatScheduleLabel(value: string) {
  return scheduleFormatter.format(new Date(value))
}

function formatCoachExperience(coachCard?: PublicCoachCardRow) {
  return coachCard ? `${coachCard.career_years}년 경력 인증 지도자` : "인증 지도자"
}

export function mapLessonMedia(filePath: string | undefined): LessonMedia {
  if (!filePath || !isSafeStoragePhotoPath(filePath)) {
    return { kind: "missing" }
  }

  const src = getSupabasePublicStorageUrl(filePath)

  return src && isSupabasePublicPhotoUrl(src) ? { kind: "photo", src } : { kind: "missing" }
}

function mapPublicLessonImages(
  images: readonly PublicLessonImageRow[],
): readonly LessonMediaImage[] {
  return images
    .filter((image) => image.lifecycle_state === "ready")
    .toSorted(
      (left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id),
    )
    .flatMap((image) => {
      const media = mapLessonMedia(image.file_path)

      return media.kind === "photo" ? [{ sortOrder: image.sort_order, url: media.src }] : []
    })
}

function isSafeStoragePhotoPath(filePath: string) {
  return (
    filePath === filePath.trim() &&
    /^[A-Za-z0-9][A-Za-z0-9/_.-]*\.(?:avif|jpe?g|png|webp)$/iu.test(filePath) &&
    !filePath.split("/").some((segment) => segment === "." || segment === "..")
  )
}

function isSupabasePublicPhotoUrl(src: string) {
  let url: URL

  try {
    url = new URL(src)
  } catch (error) {
    if (error instanceof TypeError) {
      return false
    }
    throw error
  }

  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username &&
    !url.password &&
    url.pathname.includes("/storage/v1/object/public/lesson-images/")
  )
}

function getReviewStats(reviews: readonly PublicReviewRow[]) {
  if (reviews.length === 0) {
    return { average: null, count: 0 }
  }

  const ratingTotal = reviews.reduce((total, review) => total + review.rating, 0)

  return {
    average: ratingTotal / reviews.length,
    count: reviews.length,
  }
}

function formatRatingText(stats: Readonly<{ average: number | null; count: number }>) {
  return stats.average ? `후기 평균 ${stats.average.toFixed(1)}점` : "신규 공개 레슨"
}

function formatReviewSummary(stats: Readonly<{ average: number | null; count: number }>) {
  if (!stats.average) {
    return "아직 공개 후기가 없어요. 수업 전후 문제는 예약 내역에서 신고해요."
  }

  return `공개 후기 ${stats.count}개 기준 평균 ${stats.average.toFixed(1)}점이에요.`
}

function buildDetailBullets(lesson: PublicLessonRow): readonly string[] {
  return [
    lesson.summary ?? "수업 목표와 수준을 확인해요.",
    `${lesson.duration_minutes}분 수업으로 진행돼요.`,
    lesson.cancellation_policy_summary ?? "예약 전 환불 기준을 확인해요.",
  ]
}
