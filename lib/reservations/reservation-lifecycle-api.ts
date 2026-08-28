import { z } from "zod"

import type { Database } from "@/lib/supabase/database.types"
import type { AuthUser } from "../profile/types"

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const reservationIdSchema = z.string().trim().regex(uuidPattern, "reservationId must be a UUID")
const completeBodySchema = z.object({}).strict()
const noShowBodySchema = z
  .object({
    action: z.enum(["mark_learner_no_show", "mark_coach_no_show"]),
    reason: z.string().trim().min(1).max(200),
  })
  .strict()
const lifecycleRowSchema = z.object({
  completed_at: z.iso.datetime({ offset: true }).nullable(),
  no_show_marked_at: z.iso.datetime({ offset: true }).nullable(),
  refund_amount: z.number().int().nonnegative().nullable(),
  refund_id: z.string().trim().regex(uuidPattern).nullable(),
  refund_status: z.enum(["requested", "approved", "failed", "completed"]).nullable(),
  reservation_id: reservationIdSchema,
  reservation_status: z.enum(["completed", "no_show_user", "no_show_coach"]),
  settlement_id: z.string().trim().regex(uuidPattern).nullable(),
})

export type ReservationLifecycleRequest = Readonly<{
  action: "complete" | "mark_learner_no_show" | "mark_coach_no_show"
  reason: string | null
  reservationId: string
}>
export type ReservationLifecycleParseResult = Readonly<
  | { request: ReservationLifecycleRequest; status: "success" }
  | { issues: readonly string[]; status: "failure" }
>
type LifecycleRpcArgs = Database["public"]["Functions"]["transition_reservation_lifecycle"]["Args"]
export type ReservationLifecycleRpcResult = Readonly<{ errorCode: string | null; row: unknown }>
export type ReservationLifecycleResponse = Readonly<{
  data: Readonly<{
    completedAt: string | null
    noShowMarkedAt: string | null
    refund: Readonly<{
      amount: number
      id: string
      status: "requested" | "approved" | "failed" | "completed"
    }> | null
    reservationId: string
    settlementId: string | null
    status: "completed" | "no_show_user" | "no_show_coach"
  }>
}>
export type ReservationLifecycleWorkflowDependencies = Readonly<{
  transitionReservation: (args: LifecycleRpcArgs) => Promise<ReservationLifecycleRpcResult>
  getVerifiedAuthUser: () => Promise<AuthUser | null>
}>
export type ReservationLifecycleWorkflowError = Readonly<{
  code:
    | "CONFLICT"
    | "FORBIDDEN"
    | "INTERNAL_ERROR"
    | "NOT_FOUND"
    | "UNAUTHORIZED"
    | "VALIDATION_ERROR"
  message: string
  statusCode: 401 | 403 | 404 | 409 | 422 | 500
}>
export type ReservationLifecycleWorkflowResult = Readonly<
  | { response: ReservationLifecycleResponse; status: "success"; statusCode: 200 }
  | { error: ReservationLifecycleWorkflowError; status: "failure" }
>

export function parseReservationLifecycleRequest(
  reservationId: unknown,
  action: "complete" | "no-show",
  body: unknown,
): ReservationLifecycleParseResult {
  const parsedId = reservationIdSchema.safeParse(reservationId)
  const parsedBody =
    action === "complete" ? completeBodySchema.safeParse(body) : noShowBodySchema.safeParse(body)
  if (!parsedId.success || !parsedBody.success) {
    return {
      issues: [
        ...(!parsedId.success ? parsedId.error.issues.map((issue) => issue.message) : []),
        ...(!parsedBody.success ? parsedBody.error.issues.map((issue) => issue.message) : []),
      ],
      status: "failure",
    }
  }
  if (action === "complete") {
    return {
      request: { action: "complete", reason: null, reservationId: parsedId.data },
      status: "success",
    }
  }

  return {
    request: {
      action: parsedBody.data["action"],
      reason: parsedBody.data["reason"],
      reservationId: parsedId.data,
    },
    status: "success",
  }
}

export async function runReservationLifecycleWorkflow(
  request: ReservationLifecycleRequest,
  dependencies: ReservationLifecycleWorkflowDependencies,
): Promise<ReservationLifecycleWorkflowResult> {
  if (!(await dependencies.getVerifiedAuthUser()))
    return { error: mapLifecycleFailure("UNAUTHORIZED"), status: "failure" }
  const result = await dependencies.transitionReservation({
    checked_action: request.action,
    checked_reason: request.reason,
    checked_reservation_id: request.reservationId,
  })
  const row = lifecycleRowSchema.safeParse(result.row)
  if (result.errorCode || !row.success)
    return { error: mapLifecycleFailure(result.errorCode), status: "failure" }
  return {
    response: {
      data: {
        completedAt: row.data.completed_at,
        noShowMarkedAt: row.data.no_show_marked_at,
        refund:
          row.data.refund_id === null
            ? null
            : {
                amount: row.data.refund_amount ?? 0,
                id: row.data.refund_id,
                status: row.data.refund_status ?? "requested",
              },
        reservationId: row.data.reservation_id,
        settlementId: row.data.settlement_id,
        status: row.data.reservation_status,
      },
    },
    status: "success",
    statusCode: 200,
  }
}

export function mapLifecycleFailure(errorCode: string | null): ReservationLifecycleWorkflowError {
  if (errorCode === "UNAUTHORIZED")
    return { code: "UNAUTHORIZED", message: "Authentication required.", statusCode: 401 }
  if (errorCode === "P0002")
    return { code: "NOT_FOUND", message: "Reservation not found.", statusCode: 404 }
  if (errorCode === "42501")
    return {
      code: "FORBIDDEN",
      message: "Reservation lifecycle action is forbidden.",
      statusCode: 403,
    }
  if (errorCode === "22023")
    return {
      code: "VALIDATION_ERROR",
      message: "Reservation lifecycle request is invalid.",
      statusCode: 422,
    }
  if (errorCode === "P0001" || errorCode === "23505")
    return { code: "CONFLICT", message: "Reservation cannot be transitioned.", statusCode: 409 }
  return { code: "INTERNAL_ERROR", message: "Unable to transition reservation.", statusCode: 500 }
}
