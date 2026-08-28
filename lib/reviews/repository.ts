import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/supabase/database.types"
import type { ReviewWorkflowDependencies } from "./workflow"

type Client = SupabaseClient<Database>
export function createReviewDependencies(client: Client): ReviewWorkflowDependencies {
  return {
    createReview: async ({ content, rating, reservationId }) => {
      const { data, error } = await client.rpc("create_review", {
        checked_content: content,
        checked_rating: rating,
        checked_reservation_id: reservationId,
      })
      const row = data?.[0]
      return {
        errorCode: error?.code ?? error?.message ?? null,
        row: row
          ? {
              content: row.content ?? "",
              createdAt: row.created_at,
              id: row.review_id,
              lessonId: row.lesson_id,
              rating: row.rating,
              reservationId: row.reservation_id,
            }
          : null,
      }
    },
    hideReview: async ({ reason, reviewId }) => {
      const { data, error } = await client.rpc("hide_review", {
        checked_reason: reason,
        checked_review_id: reviewId,
      })
      const row = data?.[0]
      return {
        errorCode: error?.code ?? error?.message ?? null,
        row:
          row?.status === "hidden"
            ? {
                hiddenReason: row.hidden_reason ?? "",
                id: row.review_id,
                idempotent: row.idempotent,
                status: "hidden",
              }
            : null,
      }
    },
  }
}
