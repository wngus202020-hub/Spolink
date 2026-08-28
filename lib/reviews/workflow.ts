import {
  type CreateReviewRequest,
  createReviewSchema,
  type HideReviewRequest,
  hideReviewSchema,
} from "./contract"

export type ReviewWorkflowDependencies = Readonly<{
  createReview: (
    input: CreateReviewRequest,
  ) => Promise<{ errorCode: string | null; row: ReviewRow | null }>
  hideReview: (
    input: HideReviewRequest & { reviewId: string },
  ) => Promise<{ errorCode: string | null; row: HideRow | null }>
}>
export type ReviewRow = Readonly<{
  content: string
  createdAt: string
  id: string
  lessonId: string
  rating: number
  reservationId: string
}>
export type HideRow = Readonly<{
  hiddenReason: string
  id: string
  idempotent: boolean
  status: "hidden"
}>

export function parseCreateReview(value: unknown) {
  return createReviewSchema.safeParse(value)
}
export function parseHideReview(value: unknown) {
  return hideReviewSchema.safeParse(value)
}

export async function runCreateReview(
  input: CreateReviewRequest,
  dependencies: ReviewWorkflowDependencies,
) {
  const result = await dependencies.createReview(input)
  if (result.errorCode) return failure(mapError(result.errorCode))
  if (!result.row) return failure("INTERNAL_ERROR")
  return { status: "success" as const, statusCode: 201 as const, response: { data: result.row } }
}

export async function runHideReview(
  input: HideReviewRequest & { reviewId: string },
  dependencies: ReviewWorkflowDependencies,
) {
  const result = await dependencies.hideReview(input)
  if (result.errorCode) return failure(mapError(result.errorCode))
  if (!result.row) return failure("INTERNAL_ERROR")
  return { status: "success" as const, statusCode: 200 as const, response: { data: result.row } }
}

function mapError(errorCode: string) {
  if (errorCode.includes("42501") || errorCode.includes("FORBIDDEN")) return "FORBIDDEN" as const
  if (errorCode.includes("P0002")) return "NOT_FOUND" as const
  if (errorCode.includes("23505") || errorCode.includes("P0001")) return "CONFLICT" as const
  if (errorCode.includes("22023")) return "VALIDATION_ERROR" as const
  return "INTERNAL_ERROR" as const
}
function failure(
  code: "CONFLICT" | "FORBIDDEN" | "INTERNAL_ERROR" | "NOT_FOUND" | "VALIDATION_ERROR",
) {
  const statusCode =
    code === "VALIDATION_ERROR"
      ? 422
      : code === "NOT_FOUND"
        ? 404
        : code === "CONFLICT"
          ? 409
          : code === "FORBIDDEN"
            ? 403
            : 500
  return {
    error: { code, message: "Review request could not be completed.", statusCode },
    status: "failure" as const,
  }
}
