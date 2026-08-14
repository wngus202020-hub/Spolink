import type { AuthUser, WorkflowResult } from "../profile/types"

export type CoachSubmissionData = Readonly<{
  coachStatus: "submitted"
  profileRole: "learner"
  profileStatus: "pending_coach"
  submittedAt: string
}>

export type CoachSubmissionRpcResult = Readonly<{
  application: CoachSubmissionData | null
  errorCode: string | null
  errorMessage: string | null
}>

export type CoachSubmissionDependencies = Readonly<{
  getVerifiedAuthUser: () => Promise<AuthUser | null>
  submitCoachApplication: () => Promise<CoachSubmissionRpcResult>
}>

export async function runSubmitCoachApplicationWorkflow(
  dependencies: CoachSubmissionDependencies,
): Promise<WorkflowResult<Readonly<{ data: CoachSubmissionData }>>> {
  const user = await dependencies.getVerifiedAuthUser()
  if (!user) return failure("UNAUTHORIZED", "Authentication required.", 401)

  const result = await dependencies.submitCoachApplication()
  if (result.errorCode || !result.application) {
    return mapSubmissionFailure(result.errorMessage)
  }

  return {
    response: { data: result.application },
    status: "success",
    statusCode: 200,
  }
}

function mapSubmissionFailure(errorMessage: string | null) {
  switch (errorMessage) {
    case "ACCOUNT_DELETED":
      return failure(errorMessage, "Account is unavailable.", 403)
    case "ACCOUNT_SUSPENDED":
      return failure(errorMessage, "Account is suspended.", 403)
    case "COACH_APPLICATION_CONFLICT":
      return failure(
        errorMessage,
        "Coach application cannot be submitted from its current state.",
        409,
      )
    case "COACH_APPLICATION_INCOMPLETE":
      return failure(errorMessage, "Coach application is incomplete.", 422)
    case "COACH_APPLICATION_NOT_FOUND":
      return failure(errorMessage, "Coach application was not found.", 404)
    case "COACH_CERTIFICATE_INVALID":
      return failure(errorMessage, "Certificate object metadata is invalid.", 422)
    case "COACH_CERTIFICATE_REQUIRED":
      return failure(errorMessage, "At least one certificate is required.", 422)
    case "FORBIDDEN":
      return failure(errorMessage, "Coach application submission is not allowed.", 403)
    case "PROFILE_REQUIRED":
      return failure(errorMessage, "Profile setup required.", 409)
    case "UNAUTHORIZED":
      return failure(errorMessage, "Authentication required.", 401)
    default:
      return failure("INTERNAL_ERROR", "Unable to submit coach application.", 500)
  }
}

function failure(code: string, message: string, statusCode: number) {
  return { error: { code, message, statusCode }, status: "failure" as const }
}
