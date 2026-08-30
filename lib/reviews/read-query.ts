import { REVIEWS_PER_PAGE } from "./read-presentation"
import type {
  OwnedReviewsReadResult,
  ReviewHistoryEnrichmentResult,
  ReviewHistoryQueryDependencies,
  ReviewHistoryReadSnapshot,
  ReviewHistorySnapshot,
} from "./read-types"

const defaultDependencies: ReviewHistoryQueryDependencies = {
  enrichOwnedReviews,
  readOwnedReviews,
}

export async function readReviewHistorySnapshot(
  learnerId: string,
  page: number,
  dependencies: ReviewHistoryQueryDependencies = defaultDependencies,
): Promise<ReviewHistoryReadSnapshot> {
  const firstRow = (page - 1) * REVIEWS_PER_PAGE
  const lastRow = firstRow + REVIEWS_PER_PAGE - 1
  try {
    const owned = await dependencies.readOwnedReviews(learnerId, firstRow, lastRow)
    if (owned.kind === "read_failure") return { kind: "read_failure" }
    if (owned.reviews.length === 0) {
      return {
        coaches: [],
        kind: "found",
        lessons: [],
        reviews: [],
        totalCount: owned.totalCount,
      }
    }

    const lessonIds = unique(owned.reviews.map((review) => review.lessonId))
    const coachIds = unique(owned.reviews.map((review) => review.coachProfileId))
    const enrichment = await dependencies.enrichOwnedReviews(lessonIds, coachIds)
    if (enrichment.kind === "read_failure") return { kind: "read_failure" }
    return {
      coaches: enrichment.coaches,
      kind: "found",
      lessons: enrichment.lessons,
      reviews: owned.reviews,
      totalCount: owned.totalCount,
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { kind: "read_failure" }
  }
}

async function readOwnedReviews(
  learnerId: string,
  firstRow: number,
  lastRow: number,
): Promise<OwnedReviewsReadResult> {
  const { createSupabaseServerComponentClient } = await import("@/lib/auth/server-profile")
  const supabase = await createSupabaseServerComponentClient()
  const result = await supabase
    .from("reviews")
    .select("id,lesson_id,coach_profile_id,rating,content,status,hidden_reason,created_at", {
      count: "exact",
    })
    .eq("reviewer_id", learnerId)
    .in("status", ["visible", "hidden"])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(firstRow, lastRow)

  if (result.error) return { kind: "read_failure" }
  const reviews = (result.data ?? []).flatMap(mapOwnedReview)
  return {
    kind: "found",
    reviews,
    totalCount: result.count ?? reviews.length,
  }
}

async function enrichOwnedReviews(
  lessonIds: readonly string[],
  coachIds: readonly string[],
): Promise<ReviewHistoryEnrichmentResult> {
  const { createSupabaseServiceClient } = await import("@/lib/supabase/server")
  const serviceSupabase = createSupabaseServiceClient()
  const [lessonResult, coachResult] = await Promise.all([
    serviceSupabase.from("lessons").select("id,title,status,coach_profile_id").in("id", lessonIds),
    serviceSupabase.from("coach_profiles").select("id,status").in("id", coachIds),
  ])
  if (lessonResult.error || coachResult.error) return { kind: "read_failure" }
  return {
    coaches: (coachResult.data ?? []).map((coach) => ({
      id: coach.id,
      status: coach.status,
    })),
    kind: "found",
    lessons: (lessonResult.data ?? []).map((lesson) => ({
      coachProfileId: lesson.coach_profile_id,
      id: lesson.id,
      status: lesson.status,
      title: lesson.title,
    })),
  }
}

function mapOwnedReview(row: {
  coach_profile_id: string
  content: string | null
  created_at: string
  hidden_reason: string | null
  id: string
  lesson_id: string
  rating: number
  status: "deleted" | "hidden" | "visible"
}): readonly ReviewHistorySnapshot[] {
  if (row.status === "deleted") return []
  return [
    {
      coachProfileId: row.coach_profile_id,
      content: row.content,
      createdAt: row.created_at,
      hiddenReason: row.hidden_reason,
      id: row.id,
      lessonId: row.lesson_id,
      rating: row.rating,
      status: row.status,
    },
  ]
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)]
}
