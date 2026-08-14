import type { WorkflowFailure, WorkflowResult } from "../profile/types"
import type {
  ApplicantApplicationData,
  ApplicantApplicationResponse,
  ApplicantWorkflowDependencies,
  CertificateRegistrationRequest,
  SignedUploadData,
} from "./applicant-types"
import type {
  CoachApplicationRequest,
  CoachCertificateRow,
  CoachCertificationProfileRow,
} from "./contract"
import { isCoachCertificationEditable } from "./contract"

export async function runReadCoachApplication(
  dependencies: ApplicantWorkflowDependencies,
): Promise<WorkflowResult<ApplicantApplicationResponse>> {
  const owner = await readOwner(dependencies)
  if (owner.status === "failure") return owner
  const result = await dependencies.readApplication(owner.userId)
  if (result.errorCode) return internalFailure()
  return success({
    data: result.profile ? mapApplication(result.profile, result.certificates) : null,
  })
}

export async function runSaveCoachApplication(
  request: CoachApplicationRequest,
  dependencies: ApplicantWorkflowDependencies,
): Promise<WorkflowResult<ApplicantApplicationResponse>> {
  const owner = await readOwner(dependencies)
  if (owner.status === "failure") return owner
  const current = await dependencies.readApplication(owner.userId)
  if (current.errorCode) return internalFailure()
  if (current.profile && !isCoachCertificationEditable(current.profile.status)) {
    return failure("COACH_APPLICATION_CONFLICT", "Coach application is read-only.", 409)
  }
  const updated = await dependencies.updateApplication(owner.userId, request)
  if (updated.errorCode) return mapDraftMutationFailure(updated.errorCode)
  if (!updated.profile) return internalFailure()
  const refreshed = await dependencies.readApplication(owner.userId)
  if (refreshed.errorCode) return internalFailure()
  return success({ data: mapApplication(updated.profile, refreshed.certificates) })
}

export async function runCreateCertificateUpload(
  input: Readonly<{ mimeType: string; sizeBytes: number }>,
  dependencies: ApplicantWorkflowDependencies,
): Promise<WorkflowResult<Readonly<{ data: SignedUploadData }>>> {
  const owner = await readOwner(dependencies)
  if (owner.status === "failure") return owner
  const result = await dependencies.createSignedUpload(
    owner.userId,
    input.mimeType,
    input.sizeBytes,
  )
  if (result.errorCode || !result.result) return storageFailure(result.errorCode)
  return success({ data: result.result })
}

export async function runRegisterCertificate(
  request: CertificateRegistrationRequest,
  dependencies: ApplicantWorkflowDependencies,
): Promise<WorkflowResult<ApplicantApplicationResponse>> {
  const owner = await readOwner(dependencies)
  if (owner.status === "failure") return owner
  const created = await dependencies.createCertificate(owner.userId, request)
  if (created.errorCode) return storageFailure(created.errorCode)
  return runReadCoachApplication(dependencies)
}

export async function runDeleteCertificate(
  certificateId: string,
  dependencies: ApplicantWorkflowDependencies,
): Promise<WorkflowResult<Readonly<{ data: { deleted: true } }>>> {
  const owner = await readOwner(dependencies)
  if (owner.status === "failure") return owner
  const deleted = await dependencies.deleteCertificate(owner.userId, certificateId)
  if (deleted.errorCode === "not_found")
    return failure("NOT_FOUND", "Certificate was not found.", 404)
  if (deleted.errorCode === "conflict")
    return failure("COACH_APPLICATION_CONFLICT", "Coach application is read-only.", 409)
  if (deleted.errorCode) return internalFailure()
  return success({ data: { deleted: true } })
}

function mapApplication(
  profile: CoachCertificationProfileRow,
  certificates: readonly CoachCertificateRow[],
): ApplicantApplicationData {
  return {
    bankAccountLast4: profile.bank_account_last4,
    bankName: profile.bank_name,
    bio: profile.bio,
    careerYears: profile.career_years,
    certificates: certificates.map((row) => ({
      certificateName: row.certificate_name,
      certificateNumber: row.certificate_number,
      id: row.id,
      issuer: row.issuer,
      verifiedAt: row.verified_at,
    })),
    headline: profile.headline,
    id: profile.id,
    payoutHolderName: profile.payout_holder_name,
    primarySportId: profile.primary_sport_id,
    rejectionReason: profile.rejection_reason,
    serviceRegion: profile.service_region,
    status: profile.status,
  }
}

async function readOwner(dependencies: ApplicantWorkflowDependencies) {
  const user = await dependencies.getVerifiedAuthUser()
  if (!user) return { ...failure("UNAUTHORIZED", "Authentication required.", 401), userId: "" }
  const account = await dependencies.readAccount(user.id)
  if (account.errorCode) return { ...internalFailure(), userId: user.id }
  if (!account.row)
    return { ...failure("PROFILE_REQUIRED", "Profile setup required.", 409), userId: user.id }
  if (account.row.deleted_at || account.row.status === "deleted") {
    return { ...failure("ACCOUNT_DELETED", "Account is unavailable.", 403), userId: user.id }
  }
  if (account.row.status === "suspended") {
    return { ...failure("ACCOUNT_SUSPENDED", "Account is suspended.", 403), userId: user.id }
  }
  if (account.row.role !== "learner") {
    return { ...failure("FORBIDDEN", "Learner account required.", 403), userId: user.id }
  }
  return { status: "success" as const, userId: user.id }
}

function success<T>(response: T): WorkflowResult<T> {
  return { response, status: "success", statusCode: 200 }
}

function failure(code: string, message: string, statusCode: number): WorkflowFailure {
  return { error: { code, message, statusCode }, status: "failure" }
}

function internalFailure() {
  return failure("INTERNAL_ERROR", "Unable to complete coach application request.", 500)
}

function mapDraftMutationFailure(code: string) {
  switch (code) {
    case "ACCOUNT_DELETED":
      return failure(code, "Account is unavailable.", 403)
    case "ACCOUNT_SUSPENDED":
      return failure(code, "Account is suspended.", 403)
    case "COACH_APPLICATION_CONFLICT":
      return failure(code, "Coach application is read-only.", 409)
    case "FORBIDDEN":
      return failure(code, "Learner account required.", 403)
    case "PROFILE_REQUIRED":
      return failure(code, "Profile setup required.", 409)
    case "UNAUTHORIZED":
      return failure(code, "Authentication required.", 401)
    case "VALIDATION_ERROR":
      return failure(code, "Invalid coach application request.", 422)
    default:
      return internalFailure()
  }
}

function storageFailure(code: string | null) {
  if (code === "forbidden") return failure("FORBIDDEN", "Certificate action is not allowed.", 403)
  if (code === "not_found") return failure("NOT_FOUND", "Certificate object was not found.", 404)
  if (code === "invalid_file" || code === "invalid_object_name") {
    return failure("VALIDATION_ERROR", "Certificate file is invalid.", 422)
  }
  return internalFailure()
}
