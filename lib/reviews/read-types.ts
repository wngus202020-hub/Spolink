import type { Database } from "@/lib/supabase/database.types"

export type ReviewHistoryStatus = Exclude<Database["public"]["Enums"]["review_status"], "deleted">
export type ReviewLessonStatus = Database["public"]["Enums"]["lesson_status"]
export type ReviewCoachStatus = Database["public"]["Enums"]["coach_status"]
export type ReviewHistoryBadgeTone = "success" | "warning"

export type ReviewHistorySnapshot = Readonly<{
  coachProfileId: string
  content: string | null
  createdAt: string
  hiddenReason: string | null
  id: string
  lessonId: string
  rating: number
  status: ReviewHistoryStatus
}>
export type ReviewHistoryLessonSnapshot = Readonly<{
  coachProfileId: string
  id: string
  status: ReviewLessonStatus
  title: string
}>
export type ReviewHistoryCoachSnapshot = Readonly<{
  id: string
  status: ReviewCoachStatus
}>
export type ReviewHistoryEnrichment = Readonly<{
  coaches: readonly ReviewHistoryCoachSnapshot[]
  lessons: readonly ReviewHistoryLessonSnapshot[]
}>
export type ReviewHistoryReadSnapshot = Readonly<
  | ({
      kind: "found"
      reviews: readonly ReviewHistorySnapshot[]
      totalCount: number
    } & ReviewHistoryEnrichment)
  | { kind: "read_failure" }
>
export type OwnedReviewsReadResult = Readonly<
  | { kind: "found"; reviews: readonly ReviewHistorySnapshot[]; totalCount: number }
  | { kind: "read_failure" }
>
export type ReviewHistoryEnrichmentResult = Readonly<
  ({ kind: "found" } & ReviewHistoryEnrichment) | { kind: "read_failure" }
>
export type ReviewHistoryQueryDependencies = Readonly<{
  enrichOwnedReviews: (
    lessonIds: readonly string[],
    coachIds: readonly string[],
  ) => Promise<ReviewHistoryEnrichmentResult>
  readOwnedReviews: (
    learnerId: string,
    firstRow: number,
    lastRow: number,
  ) => Promise<OwnedReviewsReadResult>
}>
export type ReviewHistoryRead = (
  learnerId: string,
  page: number,
) => Promise<ReviewHistoryReadSnapshot>
export type ReviewHistoryItemView = Readonly<{
  content: string
  createdAtText: string
  hiddenReason: string | null
  key: string
  lessonHref: string | null
  lessonTitle: string
  rating: number
  ratingLabel: string
  status: Readonly<{ label: string; tone: ReviewHistoryBadgeTone }>
}>
export type ReviewHistoryViewModel = Readonly<{
  items: readonly ReviewHistoryItemView[]
  page: number
  totalCount: number
  totalPages: number
}>
export type ReviewHistoryData = Readonly<
  | { state: "read_failure"; viewModel: null }
  | { state: "empty" | "out_of_range" | "ready"; viewModel: ReviewHistoryViewModel }
>
