import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  COACH_CERTIFICATE_BUCKET,
  CoachCertificateStorageError,
  createCoachCertificateSignedUpload,
  registerCertificateMetadataWithCompensation,
} from "../storage/coach-certification"
import type { Database } from "../supabase/database.types"
import type {
  ApplicantWorkflowDependencies,
  CertificateMutationResult,
  CertificateRegistrationRequest,
} from "./applicant-types"
import type { CoachApplicationRequest } from "./contract"

type SupabaseAppClient = SupabaseClient<Database>

export function createApplicantWorkflowDependencies(
  supabase: SupabaseAppClient,
): ApplicantWorkflowDependencies {
  return {
    createCertificate: (userId, request) => createCertificate(supabase, userId, request),
    createSignedUpload: (userId, mimeType, sizeBytes) =>
      createSignedUpload(supabase, userId, mimeType, sizeBytes),
    deleteCertificate: (userId, certificateId) =>
      deleteCertificate(supabase, userId, certificateId),
    getVerifiedAuthUser: async () => {
      const { data, error } = await supabase.auth.getClaims()
      const userId = typeof data?.claims.sub === "string" ? data.claims.sub : null
      return error || !userId ? null : { id: userId }
    },
    readAccount: async (userId) => {
      const { data: row, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle()
      return { errorCode: error?.code ?? null, row }
    },
    readApplication: async (userId) => {
      const { data: profile, error } = await supabase
        .from("coach_profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle()
      if (error || !profile) {
        return { certificates: [], errorCode: error?.code ?? null, profile }
      }
      const { data: certificates, error: certificateError } = await supabase
        .from("coach_certificates")
        .select("*")
        .eq("coach_profile_id", profile.id)
        .order("created_at", { ascending: true })
      return {
        certificates: certificates ?? [],
        errorCode: certificateError?.code ?? null,
        profile,
      }
    },
    updateApplication: (userId, request) => updateApplication(supabase, userId, request),
  }
}

async function updateApplication(
  supabase: SupabaseAppClient,
  _userId: string,
  request: CoachApplicationRequest,
) {
  const { data, error } = await supabase.rpc("upsert_coach_application_draft", {
    checked_bank_account_last4: request.bankAccountLast4,
    checked_bank_name: request.bankName,
    checked_bio: request.bio,
    checked_career_years: request.careerYears,
    checked_headline: request.headline,
    checked_payout_holder_name: request.payoutHolderName,
    checked_primary_sport_id: request.primarySportId,
    checked_service_region: request.serviceRegion,
  })
  return { errorCode: normalizeDraftRpcError(error), profile: data?.[0] ?? null }
}

const DRAFT_RPC_DOMAIN_ERRORS = new Set([
  "ACCOUNT_DELETED",
  "ACCOUNT_SUSPENDED",
  "COACH_APPLICATION_CONFLICT",
  "FORBIDDEN",
  "PROFILE_REQUIRED",
  "UNAUTHORIZED",
  "VALIDATION_ERROR",
])

function normalizeDraftRpcError(error: Readonly<{ code: string; message: string }> | null) {
  if (!error) return null
  if (error.code === "P0001" && DRAFT_RPC_DOMAIN_ERRORS.has(error.message)) return error.message
  return error.code
}

async function createSignedUpload(
  supabase: SupabaseAppClient,
  userId: string,
  mimeType: string,
  sizeBytes: number,
) {
  try {
    const signed = await createCoachCertificateSignedUpload(
      { mimeType, sizeBytes, userId },
      {
        createObjectId: randomUUID,
        createSignedUploadUrl: async (bucket, objectName) => {
          const { data, error } = await supabase.storage
            .from(bucket)
            .createSignedUploadUrl(objectName, { upsert: false })
          if (error) throw new ApplicantRepositoryError("storage_failure", { cause: error })
          return { signedUrl: data.signedUrl, token: data.token }
        },
        readApplicantState: async (ownerId) => {
          const [{ data: account }, { data: coach }] = await Promise.all([
            supabase.from("profiles").select("role,status").eq("id", ownerId).maybeSingle(),
            supabase.from("coach_profiles").select("status").eq("user_id", ownerId).maybeSingle(),
          ])
          return account && coach
            ? { coachStatus: coach.status, role: account.role, status: account.status }
            : null
        },
      },
    )
    return {
      errorCode: null,
      result: {
        expiresIn: signed.expiresIn,
        objectName: signed.objectName,
        uploadUrl: signed.uploadUrl,
      },
    }
  } catch (error) {
    if (error instanceof CoachCertificateStorageError)
      return { errorCode: error.code, result: null }
    if (error instanceof ApplicantRepositoryError) return { errorCode: error.code, result: null }
    throw error
  }
}

async function createCertificate(
  supabase: SupabaseAppClient,
  userId: string,
  request: CertificateRegistrationRequest,
): Promise<CertificateMutationResult> {
  let createdRow: CertificateMutationResult["row"] = null
  try {
    const { data: profile, error } = await supabase
      .from("coach_profiles")
      .select("id,status")
      .eq("user_id", userId)
      .maybeSingle()
    if (error) return { errorCode: error.code, row: null }
    if (!profile || (profile.status !== "draft" && profile.status !== "rejected")) {
      return { errorCode: "forbidden", row: null }
    }
    await registerCertificateMetadataWithCompensation(
      { objectName: request.objectName, userId },
      {
        readObject: async (bucket, objectName) => {
          const { data, error: readError } = await supabase.storage
            .from(bucket)
            .download(objectName)
          if (readError) return null
          return data
        },
        registerMetadata: async (_validated, objectName) => {
          const { data, error: insertError } = await supabase
            .from("coach_certificates")
            .insert({
              certificate_name: request.certificateName,
              certificate_number: request.certificateNumber ?? null,
              coach_profile_id: profile.id,
              file_path: objectName,
              issuer: request.issuer ?? null,
            })
            .select("*")
            .single()
          if (insertError)
            throw new ApplicantRepositoryError(insertError.code, { cause: insertError })
          createdRow = data
        },
        removeObject: async (bucket, objectName) => {
          const { error: removeError } = await supabase.storage.from(bucket).remove([objectName])
          if (removeError)
            throw new ApplicantRepositoryError("storage_failure", { cause: removeError })
        },
      },
    )
    return { errorCode: createdRow ? null : "metadata_registration_failed", row: createdRow }
  } catch (error) {
    if (error instanceof CoachCertificateStorageError) return { errorCode: error.code, row: null }
    if (error instanceof ApplicantRepositoryError) return { errorCode: error.code, row: null }
    throw error
  }
}

async function deleteCertificate(
  supabase: SupabaseAppClient,
  userId: string,
  certificateId: string,
) {
  const { data: profile, error } = await supabase
    .from("coach_profiles")
    .select("id,status")
    .eq("user_id", userId)
    .maybeSingle()
  if (error) return { errorCode: error.code }
  if (!profile) return { errorCode: "not_found" }
  if (profile.status !== "draft" && profile.status !== "rejected") return { errorCode: "conflict" }
  const { data: certificate, error: readError } = await supabase
    .from("coach_certificates")
    .select("id,file_path")
    .eq("id", certificateId)
    .eq("coach_profile_id", profile.id)
    .maybeSingle()
  if (readError) return { errorCode: readError.code }
  if (!certificate) return { errorCode: "not_found" }
  const { error: objectError } = await supabase.storage
    .from(COACH_CERTIFICATE_BUCKET)
    .remove([certificate.file_path])
  if (objectError) return { errorCode: objectError.message }
  const { error: deleteError } = await supabase
    .from("coach_certificates")
    .delete()
    .eq("id", certificate.id)
  return { errorCode: deleteError?.code ?? null }
}

class ApplicantRepositoryError extends Error {
  readonly code: string
  readonly name = "ApplicantRepositoryError"

  constructor(code: string, options?: ErrorOptions) {
    super("Coach certification repository operation failed.", options)
    this.code = code
  }
}
