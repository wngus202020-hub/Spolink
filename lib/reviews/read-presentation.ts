import type {
  ReviewHistoryEnrichment,
  ReviewHistoryItemView,
  ReviewHistorySnapshot,
  ReviewHistoryStatus,
} from "./read-types"

export const REVIEWS_PER_PAGE = 20

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeZone: "Asia/Seoul",
})
const statusPresentation = {
  hidden: { label: "숨김", tone: "warning" },
  visible: { label: "공개 중", tone: "success" },
} as const satisfies Record<
  ReviewHistoryStatus,
  Readonly<{ label: string; tone: "success" | "warning" }>
>

export function normalizeReviewHistoryPage(value: string | string[] | undefined): number {
  if (typeof value !== "string" || !/^\d+$/u.test(value)) return 1
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}

export function buildReviewHistoryItems(
  reviews: readonly ReviewHistorySnapshot[],
  enrichment: ReviewHistoryEnrichment,
): readonly ReviewHistoryItemView[] {
  const lessonsById = new Map(enrichment.lessons.map((lesson) => [lesson.id, lesson]))
  const coachesById = new Map(enrichment.coaches.map((coach) => [coach.id, coach]))

  return [...reviews].sort(compareNewestFirst).map((review) => {
    const lesson = lessonsById.get(review.lessonId)
    const coach = coachesById.get(review.coachProfileId)
    const canOpenLesson =
      lesson?.coachProfileId === review.coachProfileId &&
      lesson.status === "active" &&
      coach?.status === "approved"

    return {
      content: review.content?.trim() || "작성한 내용이 없습니다.",
      createdAtText: formatReviewDate(review.createdAt),
      hiddenReason:
        review.status === "hidden"
          ? review.hiddenReason?.trim() || "숨김 사유를 확인해 주세요."
          : null,
      key: review.id,
      lessonHref: canOpenLesson ? `/lessons/${encodeURIComponent(review.lessonId)}` : null,
      lessonTitle: lesson?.title.trim() || "더 이상 공개되지 않는 레슨",
      rating: review.rating,
      ratingLabel: `5점 만점에 ${review.rating}점`,
      status: statusPresentation[review.status],
    }
  })
}

function compareNewestFirst(left: ReviewHistorySnapshot, right: ReviewHistorySnapshot): number {
  if (left.createdAt < right.createdAt) return 1
  if (left.createdAt > right.createdAt) return -1
  if (left.id < right.id) return 1
  if (left.id > right.id) return -1
  return 0
}

function formatReviewDate(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? dateFormatter.format(date) : "날짜 확인 필요"
}
