import { z } from "zod"

import type { Database } from "@/lib/supabase/database.types"
import type { AuthUser, ProfileReadResult, ProfileRow } from "../profile/types"

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const preparePaymentRequestSchema = z.object({
  reservationId: z.string().trim().regex(uuidPattern, "reservationId must be a UUID"),
})

export type PreparePaymentRequest = z.infer<typeof preparePaymentRequestSchema>

export type PreparePaymentRequestParseResult = Readonly<
  | {
      request: PreparePaymentRequest
      status: "success"
    }
  | {
      issues: readonly string[]
      status: "failure"
    }
>

export type PreparePaymentResponse = Readonly<{
  data: Readonly<{
    amount: number
    orderName: string
    paymentId: string
    provider: "toss"
    providerOrderId: string
  }>
}>

export type PreparePaymentWorkflowResult = Readonly<
  | {
      response: PreparePaymentResponse
      status: "success"
      statusCode: 201
    }
  | {
      error: PreparePaymentWorkflowError
      status: "failure"
    }
>

export type PreparePaymentWorkflowError = Readonly<{
  code:
    | "ACCOUNT_DELETED"
    | "ACCOUNT_SUSPENDED"
    | "CONFLICT"
    | "FORBIDDEN"
    | "INTERNAL_ERROR"
    | "NOT_FOUND"
    | "PROFILE_REQUIRED"
    | "RESERVATION_EXPIRED"
    | "UNAUTHORIZED"
  message: string
  statusCode: 401 | 403 | 404 | 409 | 500
}>

export type PreparePaymentWorkflowDependencies = Readonly<{
  createReadyPayment: (request: PreparePaymentRequest) => Promise<PreparePaymentRpcResult>
  getCurrentProfile: (userId: string) => Promise<ProfileReadResult>
  getVerifiedAuthUser: () => Promise<AuthUser | null>
}>

export type PreparePaymentRpcResult = Readonly<{
  errorCode: string | null
  payment: PreparedPaymentRow | null
}>

type PreparedPaymentRow = Database["public"]["Functions"]["create_ready_payment"]["Returns"][number]

export function parsePreparePaymentRequest(value: unknown): PreparePaymentRequestParseResult {
  const parsedRequest = preparePaymentRequestSchema.safeParse(value)

  return parsedRequest.success
    ? { request: parsedRequest.data, status: "success" }
    : { issues: parsedRequest.error.issues.map((issue) => issue.message), status: "failure" }
}

export async function runPreparePaymentWorkflow(
  request: PreparePaymentRequest,
  dependencies: PreparePaymentWorkflowDependencies,
): Promise<PreparePaymentWorkflowResult> {
  const user = await dependencies.getVerifiedAuthUser()

  if (!user) {
    return { error: mapPreparePaymentFailure("UNAUTHORIZED"), status: "failure" }
  }

  const profilePrecondition = readCommerceProfileFailure(
    await dependencies.getCurrentProfile(user.id),
  )

  if (profilePrecondition) {
    return { error: profilePrecondition, status: "failure" }
  }

  const result = await dependencies.createReadyPayment(request)

  if (!result.payment) {
    return { error: mapPreparePaymentFailure(result.errorCode), status: "failure" }
  }

  return {
    response: buildPreparePaymentResponse(result.payment),
    status: "success",
    statusCode: 201,
  }
}

export function buildPreparePaymentResponse(row: PreparedPaymentRow): PreparePaymentResponse {
  return {
    data: {
      amount: row.amount,
      orderName: row.order_name,
      paymentId: row.payment_id,
      provider: parsePreparePaymentProvider(row.provider),
      providerOrderId: row.provider_order_id,
    },
  }
}

function parsePreparePaymentProvider(provider: string): "toss" {
  if (provider === "toss") {
    return provider
  }

  throw new Error(`Unsupported payment provider: ${provider}`)
}

export function mapPreparePaymentFailure(errorCode: string | null): PreparePaymentWorkflowError {
  if (errorCode === "UNAUTHORIZED") {
    return { code: "UNAUTHORIZED", message: "Authentication required.", statusCode: 401 }
  }

  if (errorCode === "42501") {
    return { code: "FORBIDDEN", message: "Learner account required.", statusCode: 403 }
  }

  if (errorCode === "P0002") {
    return { code: "NOT_FOUND", message: "Reservation not found.", statusCode: 404 }
  }

  if (errorCode === "P0005") {
    return { code: "RESERVATION_EXPIRED", message: "Reservation expired.", statusCode: 409 }
  }

  return { code: "CONFLICT", message: "Payment cannot be prepared.", statusCode: 409 }
}

function readCommerceProfileFailure(
  profileResult: ProfileReadResult,
): PreparePaymentWorkflowError | null {
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

function readAccountStateFailure(profile: ProfileRow): PreparePaymentWorkflowError | null {
  if (profile.status === "deleted" || profile.deleted_at !== null) {
    return { code: "ACCOUNT_DELETED", message: "Account is unavailable.", statusCode: 403 }
  }

  if (profile.status === "suspended") {
    return { code: "ACCOUNT_SUSPENDED", message: "Account is suspended.", statusCode: 403 }
  }

  return null
}
