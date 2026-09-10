import { z } from "zod"

import type { WorkflowResult } from "../profile/types"

export const ACCOUNT_WITHDRAWAL_CONFIRMATION = "탈퇴하기"

const accountWithdrawalRequestSchema = z.strictObject({
  confirmation: z.literal(ACCOUNT_WITHDRAWAL_CONFIRMATION),
})

export type AccountWithdrawalRequest = z.infer<typeof accountWithdrawalRequestSchema>

export type AccountWithdrawalRow = Readonly<{
  account_id: string
  deleted_at: string
  idempotent: boolean
}>

type AccountProfileRead =
  | Readonly<{ avatarPath: string | null; status: "found" }>
  | Readonly<{ status: "missing" }>
  | Readonly<{ status: "failure" }>

type AccountWithdrawalMutation =
  | Readonly<{ status: "success"; withdrawal: AccountWithdrawalRow }>
  | Readonly<{ errorCode: string; status: "failure" }>

export type AccountWithdrawalDependencies = Readonly<{
  getVerifiedUserId: () => Promise<string | null>
  readProfile: (userId: string) => Promise<AccountProfileRead>
  removeAvatar: (avatarPath: string) => Promise<Readonly<{ status: "failure" | "success" }>>
  withdrawAccount: () => Promise<AccountWithdrawalMutation>
}>

export type AccountWithdrawalResponse = Readonly<{
  data: Readonly<{ deletedAt: string; idempotent: boolean }>
}>

export function parseAccountWithdrawalRequest(
  value: unknown,
):
  | Readonly<{ request: AccountWithdrawalRequest; status: "success" }>
  | Readonly<{ status: "failure" }> {
  const parsed = accountWithdrawalRequestSchema.safeParse(value)
  return parsed.success ? { request: parsed.data, status: "success" } : { status: "failure" }
}

export async function runAccountWithdrawal(
  dependencies: AccountWithdrawalDependencies,
): Promise<WorkflowResult<AccountWithdrawalResponse>> {
  const userId = await dependencies.getVerifiedUserId()
  if (!userId) return failure("UNAUTHORIZED", "Authentication required.", 401)

  const profile = await dependencies.readProfile(userId)
  if (profile.status === "failure") return internalError()
  if (profile.status === "missing") {
    return failure("PROFILE_REQUIRED", "Profile setup required.", 409)
  }

  if (profile.avatarPath) {
    const avatarRemoval = await dependencies.removeAvatar(profile.avatarPath)
    if (avatarRemoval.status === "failure") {
      return failure("ACCOUNT_CLEANUP_FAILED", "Unable to remove account media.", 503)
    }
  }

  const mutation = await dependencies.withdrawAccount()
  if (mutation.status === "failure") return mapMutationFailure(mutation.errorCode)

  return {
    response: {
      data: {
        deletedAt: new Date(mutation.withdrawal.deleted_at).toISOString(),
        idempotent: mutation.withdrawal.idempotent,
      },
    },
    status: "success",
    statusCode: 200,
  }
}

function mapMutationFailure(errorCode: string) {
  if (errorCode === "P0002") {
    return failure("PROFILE_REQUIRED", "Profile setup required.", 409)
  }
  if (errorCode === "42501") {
    return failure("FORBIDDEN", "Account withdrawal is not allowed.", 403)
  }
  return internalError()
}

function failure(code: string, message: string, statusCode: number) {
  return { error: { code, message, statusCode }, status: "failure" as const }
}

function internalError() {
  return failure("INTERNAL_ERROR", "Unable to complete account withdrawal.", 500)
}
