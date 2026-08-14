import { z } from "zod"

import type { Database } from "@/lib/supabase/database.types"
import type { AuthUser, ProfileReadResult, ProfileRow } from "../profile/types"

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const reservationIdSchema = z.string().trim().regex(uuidPattern, "reservationId must be a UUID")
const cancelReservationBodySchema = z.object({ reason: z.string().trim().min(1).max(200) }).strict()

const refundStatusSchema = z.enum(["requested", "approved", "failed", "completed"])
const cancellationStatusSchema = z.enum([
  "cancelled_by_user",
  "cancelled_by_coach",
  "cancelled_by_admin",
])
const cancellationBaseSchema = z
  .object({
    cancelled_at: z.iso.datetime({ offset: true }),
    reservation_id: reservationIdSchema,
    reservation_status: cancellationStatusSchema,
  })
  .strict()
const cancellationRowSchema = z.union([
  cancellationBaseSchema.extend({
    refund_amount: z.null(),
    refund_id: z.null(),
    refund_status: z.null(),
  }),
  cancellationBaseSchema.extend({
    refund_amount: z.number().int().nonnegative(),
    refund_id: reservationIdSchema,
    refund_status: refundStatusSchema,
  }),
])

export type CancelReservationRequest = Readonly<{
  reason: string
  reservationId: string
}>

export type CancelReservationRequestParseResult = Readonly<
  | { request: CancelReservationRequest; status: "success" }
  | { issues: readonly string[]; status: "failure" }
>

type CancellationRow = z.infer<typeof cancellationRowSchema>
type CancelReservationRpcArgs = Database["public"]["Functions"]["cancel_reservation"]["Args"]

export type CancelReservationRpcResult = Readonly<{
  cancellation: unknown
  errorCode: string | null
}>

export type CancelReservationWorkflowDependencies = Readonly<{
  cancelReservation: (args: CancelReservationRpcArgs) => Promise<CancelReservationRpcResult>
  getCurrentProfile: (userId: string) => Promise<ProfileReadResult>
  getVerifiedAuthUser: () => Promise<AuthUser | null>
}>

export type CancelReservationResponse = Readonly<{
  data: Readonly<{
    cancelledAt: string
    refund: Readonly<{
      amount: number
      id: string
      status: z.infer<typeof refundStatusSchema>
    }> | null
    reservationId: string
    status: z.infer<typeof cancellationStatusSchema>
  }>
}>

export type CancelReservationWorkflowError = Readonly<{
  code:
    | "ACCOUNT_DELETED"
    | "ACCOUNT_SUSPENDED"
    | "CONFLICT"
    | "FORBIDDEN"
    | "INTERNAL_ERROR"
    | "INVALID_STATE_TRANSITION"
    | "NOT_FOUND"
    | "PROFILE_REQUIRED"
    | "UNAUTHORIZED"
    | "VALIDATION_ERROR"
  message: string
  statusCode: 401 | 403 | 404 | 409 | 422 | 500
}>

export type CancelReservationWorkflowResult = Readonly<
  | { response: CancelReservationResponse; status: "success"; statusCode: 200 }
  | { error: CancelReservationWorkflowError; status: "failure" }
>

export function parseCancelReservationRequest(
  reservationId: unknown,
  body: unknown,
): CancelReservationRequestParseResult {
  const parsedReservationId = reservationIdSchema.safeParse(reservationId)
  const parsedBody = cancelReservationBodySchema.safeParse(body)

  if (!parsedReservationId.success || !parsedBody.success) {
    return {
      issues: [
        ...(parsedReservationId.success
          ? []
          : parsedReservationId.error.issues.map((issue) => issue.message)),
        ...(parsedBody.success ? [] : parsedBody.error.issues.map((issue) => issue.message)),
      ],
      status: "failure",
    }
  }

  return {
    request: { reason: parsedBody.data.reason, reservationId: parsedReservationId.data },
    status: "success",
  }
}

export async function runCancelReservationWorkflow(
  request: CancelReservationRequest,
  dependencies: CancelReservationWorkflowDependencies,
): Promise<CancelReservationWorkflowResult> {
  const user = await dependencies.getVerifiedAuthUser()

  if (!user) {
    return { error: mapCancelReservationFailure("UNAUTHORIZED"), status: "failure" }
  }

  const profilePrecondition = readCommerceProfileFailure(
    await dependencies.getCurrentProfile(user.id),
  )

  if (profilePrecondition) {
    return { error: profilePrecondition, status: "failure" }
  }

  const result = await dependencies.cancelReservation({
    checked_reason: request.reason,
    checked_reservation_id: request.reservationId,
  })
  const parsedCancellation = cancellationRowSchema.safeParse(result.cancellation)

  if (result.errorCode !== null || !parsedCancellation.success) {
    return { error: mapCancelReservationFailure(result.errorCode), status: "failure" }
  }

  return {
    response: buildCancelReservationResponse(parsedCancellation.data),
    status: "success",
    statusCode: 200,
  }
}

export function buildCancelReservationResponse(row: CancellationRow): CancelReservationResponse {
  return {
    data: {
      cancelledAt: row.cancelled_at,
      refund:
        row.refund_id === null
          ? null
          : { amount: row.refund_amount, id: row.refund_id, status: row.refund_status },
      reservationId: row.reservation_id,
      status: row.reservation_status,
    },
  }
}

export function mapCancelReservationFailure(
  errorCode: string | null,
): CancelReservationWorkflowError {
  switch (errorCode) {
    case "22023":
    case "VALIDATION_ERROR":
      return {
        code: "VALIDATION_ERROR",
        message: "Reservation cancellation request is invalid.",
        statusCode: 422,
      }
    case "UNAUTHORIZED":
      return { code: "UNAUTHORIZED", message: "Authentication required.", statusCode: 401 }
    case "42501":
      return {
        code: "FORBIDDEN",
        message: "Reservation cancellation is forbidden.",
        statusCode: 403,
      }
    case "P0002":
      return { code: "NOT_FOUND", message: "Reservation not found.", statusCode: 404 }
    case "P0001":
      return {
        code: "INVALID_STATE_TRANSITION",
        message: "Reservation cannot be cancelled in its current state.",
        statusCode: 409,
      }
    case "23505":
      return {
        code: "CONFLICT",
        message: "Reservation cancellation conflicts with an existing request.",
        statusCode: 409,
      }
    default:
      return {
        code: "CONFLICT",
        message: "Reservation cannot be cancelled.",
        statusCode: 409,
      }
  }
}

function readCommerceProfileFailure(
  profileResult: ProfileReadResult,
): CancelReservationWorkflowError | null {
  if (profileResult.errorCode) {
    return {
      code: "INTERNAL_ERROR",
      message: "Unable to complete profile request.",
      statusCode: 500,
    }
  }

  if (!profileResult.profile) {
    return { code: "PROFILE_REQUIRED", message: "Profile setup required.", statusCode: 409 }
  }

  return readAccountStateFailure(profileResult.profile)
}

function readAccountStateFailure(profile: ProfileRow): CancelReservationWorkflowError | null {
  if (profile.status === "deleted" || profile.deleted_at !== null) {
    return { code: "ACCOUNT_DELETED", message: "Account is unavailable.", statusCode: 403 }
  }

  if (profile.status === "suspended") {
    return { code: "ACCOUNT_SUSPENDED", message: "Account is suspended.", statusCode: 403 }
  }

  return null
}
