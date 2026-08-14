import type { WorkflowResult } from "../profile/types"
import type {
  AdminCoachDetailData,
  AdminCoachListData,
  AdminCoachReviewData,
  AdminRepositoryResult,
  AdminReviewDependencies,
} from "./admin-types"
import type { AdminCoachListQuery } from "./contract"

export async function runListAdminCoachApplications(
  query: AdminCoachListQuery,
  dependencies: AdminReviewDependencies,
): Promise<WorkflowResult<Readonly<{ data: AdminCoachListData }>>> {
  const admin = await dependencies.getVerifiedAdmin()
  if (admin.kind !== "admin") return accessFailure(admin.kind)

  return mapReadResult(await dependencies.listApplications(query))
}

export async function runReadAdminCoachApplication(
  coachProfileId: string,
  dependencies: AdminReviewDependencies,
): Promise<WorkflowResult<Readonly<{ data: AdminCoachDetailData }>>> {
  const admin = await dependencies.getVerifiedAdmin()
  if (admin.kind !== "admin") return accessFailure(admin.kind)

  return mapReadResult(await dependencies.readApplication(coachProfileId))
}

export async function runReviewAdminCoachApplication(
  coachProfileId: string,
  decision: "approve" | "reject",
  rejectionReason: string | null,
  dependencies: AdminReviewDependencies,
): Promise<WorkflowResult<Readonly<{ data: AdminCoachReviewData }>>> {
  const admin = await dependencies.getVerifiedAdmin()
  if (admin.kind !== "admin") return accessFailure(admin.kind)

  const result = await dependencies.reviewApplication(coachProfileId, decision, rejectionReason)
  if (result.errorCode || !result.data) return mapRepositoryFailure(result.errorCode)
  return { response: { data: result.data }, status: "success", statusCode: 200 }
}

export async function runCreateAdminCertificateRead(
  coachProfileId: string,
  certificateId: string,
  dependencies: AdminReviewDependencies,
): Promise<WorkflowResult<Readonly<{ data: Readonly<{ expiresIn: 300; readUrl: string }> }>>> {
  const admin = await dependencies.getVerifiedAdmin()
  if (admin.kind !== "admin") return accessFailure(admin.kind)

  const result = await dependencies.createCertificateRead(
    admin.user.id,
    coachProfileId,
    certificateId,
  )
  if (result.errorCode || !result.data) return mapRepositoryFailure(result.errorCode)
  return { response: { data: result.data }, status: "success", statusCode: 200 }
}

function mapReadResult<T>(result: AdminRepositoryResult<T>): WorkflowResult<Readonly<{ data: T }>> {
  if (result.errorCode || !result.data) return mapRepositoryFailure(result.errorCode)
  return { response: { data: result.data }, status: "success", statusCode: 200 }
}

function mapRepositoryFailure(errorCode: string | null) {
  switch (errorCode) {
    case "UNAUTHORIZED":
      return failure(errorCode, "Authentication required.", 401)
    case "FORBIDDEN":
      return failure(errorCode, "Administrator access is required.", 403)
    case "COACH_APPLICATION_NOT_FOUND":
    case "not_found":
      return failure("COACH_APPLICATION_NOT_FOUND", "Coach application was not found.", 404)
    case "COACH_APPLICATION_CONFLICT":
      return failure(errorCode, "Coach application review state has changed.", 409)
    case "VALIDATION_ERROR":
      return failure(errorCode, "Coach review request is invalid.", 422)
    default:
      return failure("INTERNAL_ERROR", "Unable to process coach certification review.", 500)
  }
}

function accessFailure(kind: "forbidden" | "unauthenticated") {
  return kind === "unauthenticated"
    ? failure("UNAUTHORIZED", "Authentication required.", 401)
    : failure("FORBIDDEN", "Administrator access is required.", 403)
}

function failure(code: string, message: string, statusCode: number) {
  return { error: { code, message, statusCode }, status: "failure" as const }
}
