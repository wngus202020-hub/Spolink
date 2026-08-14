import { z } from "zod"

import type { Database } from "@/lib/supabase/database.types"
import type { AuthUser, ProfileReadResult, ProfileRow } from "../profile/types"

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const createReservationRequestSchema = z.object({
  lessonId: z.string().trim().regex(uuidPattern, "lessonId must be a UUID"),
  lessonScheduleId: z.string().trim().regex(uuidPattern, "lessonScheduleId must be a UUID"),
})

export type CreateReservationRequest = z.infer<typeof createReservationRequestSchema>

export type CreateReservationRequestParseResult = Readonly<
  | {
      request: CreateReservationRequest
      status: "success"
    }
  | {
      issues: readonly string[]
      status: "failure"
    }
>

export type CreateReservationResponse = Readonly<{
  data: Readonly<{
    id: string
    paymentExpiresAt: string
    reservedPriceAmount: number
    status: "pending_payment"
  }>
}>

export type CreateReservationWorkflowResult = Readonly<
  | {
      response: CreateReservationResponse
      status: "success"
      statusCode: 201
    }
  | {
      error: CreateReservationWorkflowError
      status: "failure"
    }
>

export type CreateReservationWorkflowError = Readonly<{
  code:
    | "ACCOUNT_DELETED"
    | "ACCOUNT_SUSPENDED"
    | "CAPACITY_EXCEEDED"
    | "CONFLICT"
    | "FORBIDDEN"
    | "INTERNAL_ERROR"
    | "NOT_FOUND"
    | "PROFILE_REQUIRED"
    | "UNAUTHORIZED"
  message: string
  statusCode: 401 | 403 | 404 | 409 | 500
}>

export type CreateReservationWorkflowDependencies = Readonly<{
  createPendingReservation: (
    request: CreateReservationRequest,
  ) => Promise<CreateReservationRpcResult>
  getCurrentProfile: (userId: string) => Promise<ProfileReadResult>
  getVerifiedAuthUser: () => Promise<AuthUser | null>
}>

export type CreateReservationRpcResult = Readonly<{
  errorCode: string | null
  reservation: ReservationRow | null
}>

type ReservationRow = Database["public"]["Tables"]["reservations"]["Row"]
type PendingReservationRow = ReservationRow & Readonly<{ payment_expires_at: string }>

export function parseCreateReservationRequest(value: unknown): CreateReservationRequestParseResult {
  const parsedRequest = createReservationRequestSchema.safeParse(value)

  return parsedRequest.success
    ? { request: parsedRequest.data, status: "success" }
    : { issues: parsedRequest.error.issues.map((issue) => issue.message), status: "failure" }
}

export function hasPaymentExpiration(row: ReservationRow): row is PendingReservationRow {
  return row.payment_expires_at !== null
}

export async function runCreateReservationWorkflow(
  request: CreateReservationRequest,
  dependencies: CreateReservationWorkflowDependencies,
): Promise<CreateReservationWorkflowResult> {
  const user = await dependencies.getVerifiedAuthUser()

  if (!user) {
    return { error: mapReservationCreationFailure("UNAUTHORIZED"), status: "failure" }
  }

  const profilePrecondition = readCommerceProfileFailure(
    await dependencies.getCurrentProfile(user.id),
  )

  if (profilePrecondition) {
    return { error: profilePrecondition, status: "failure" }
  }

  const result = await dependencies.createPendingReservation(request)

  if (!result.reservation || !hasPaymentExpiration(result.reservation)) {
    return { error: mapReservationCreationFailure(result.errorCode), status: "failure" }
  }

  return {
    response: buildCreateReservationResponse(result.reservation),
    status: "success",
    statusCode: 201,
  }
}

export function buildCreateReservationResponse(
  row: PendingReservationRow,
): CreateReservationResponse {
  return {
    data: {
      id: row.id,
      paymentExpiresAt: row.payment_expires_at,
      reservedPriceAmount: row.reserved_price_amount,
      status: "pending_payment",
    },
  }
}

export function mapReservationCreationFailure(
  errorCode: string | null,
): CreateReservationWorkflowError {
  if (errorCode === "UNAUTHORIZED") {
    return { code: "UNAUTHORIZED", message: "Authentication required.", statusCode: 401 }
  }

  if (errorCode === "42501") {
    return { code: "FORBIDDEN", message: "Learner account required.", statusCode: 403 }
  }

  if (errorCode === "P0002") {
    return { code: "NOT_FOUND", message: "Lesson not found.", statusCode: 404 }
  }

  if (errorCode === "P0003") {
    return { code: "CAPACITY_EXCEEDED", message: "Schedule capacity exceeded.", statusCode: 409 }
  }

  return { code: "CONFLICT", message: "Reservation cannot be created.", statusCode: 409 }
}

function readCommerceProfileFailure(
  profileResult: ProfileReadResult,
): CreateReservationWorkflowError | null {
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

function readAccountStateFailure(profile: ProfileRow): CreateReservationWorkflowError | null {
  if (profile.status === "deleted" || profile.deleted_at !== null) {
    return { code: "ACCOUNT_DELETED", message: "Account is unavailable.", statusCode: 403 }
  }

  if (profile.status === "suspended") {
    return { code: "ACCOUNT_SUSPENDED", message: "Account is suspended.", statusCode: 403 }
  }

  return null
}
