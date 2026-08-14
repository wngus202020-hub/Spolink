import type { SupabaseClient } from "@supabase/supabase-js"

import {
  CoachCertificateStorageError,
  createAdminCertificateSignedRead,
} from "../storage/coach-certification"
import type { Database } from "../supabase/database.types"

type SupabaseAppClient = SupabaseClient<Database>

export async function createAdminCertificateRead(
  supabase: SupabaseAppClient,
  certificateSigningClient: SupabaseAppClient,
  adminId: string,
  coachProfileId: string,
  certificateId: string,
) {
  const { data: certificate, error } = await supabase
    .from("coach_certificates")
    .select("file_path")
    .eq("id", certificateId)
    .eq("coach_profile_id", coachProfileId)
    .maybeSingle()
  if (error || !certificate) return { data: null, errorCode: error?.code ?? "not_found" }
  try {
    const data = await createAdminCertificateSignedRead(
      { adminUserId: adminId, objectName: certificate.file_path },
      {
        createSignedReadUrl: async (bucket, objectName, expiresIn) => {
          const signed = await certificateSigningClient.storage
            .from(bucket)
            .createSignedUrl(objectName, expiresIn)
          if (signed.error) throw new AdminCertificateRepositoryError(signed.error.message)
          return signed.data.signedUrl
        },
        isActiveAdmin: async (userId) => {
          const result = await supabase
            .from("profiles")
            .select("id")
            .eq("id", userId)
            .eq("role", "admin")
            .eq("status", "active")
            .is("deleted_at", null)
            .maybeSingle()
          return !result.error && result.data !== null
        },
        isRegisteredObject: async (objectName) => objectName === certificate.file_path,
      },
    )
    return { data, errorCode: null }
  } catch (caught) {
    if (caught instanceof CoachCertificateStorageError) {
      return { data: null, errorCode: caught.code }
    }
    if (caught instanceof AdminCertificateRepositoryError) {
      return { data: null, errorCode: caught.message }
    }
    throw caught
  }
}

class AdminCertificateRepositoryError extends Error {
  readonly name = "AdminCertificateRepositoryError"
}
