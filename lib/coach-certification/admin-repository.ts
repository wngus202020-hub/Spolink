import type { SupabaseClient } from "@supabase/supabase-js"

import { readVerifiedClaims } from "../auth/claims"
import type { Database } from "../supabase/database.types"
import { createAdminCertificateRead } from "./admin-certificate-repository"
import type { AdminReviewDependencies } from "./admin-types"

type SupabaseAppClient = SupabaseClient<Database>
type CoachProfileRow = Database["public"]["Tables"]["coach_profiles"]["Row"]

const REVIEW_RPC_ERRORS = new Set([
  "COACH_APPLICATION_CONFLICT",
  "COACH_APPLICATION_NOT_FOUND",
  "FORBIDDEN",
  "UNAUTHORIZED",
  "VALIDATION_ERROR",
])

export function createAdminReviewDependencies(
  supabase: SupabaseAppClient,
  certificateSigningClient?: SupabaseAppClient,
): AdminReviewDependencies {
  return {
    createCertificateRead: (adminId, coachProfileId, certificateId) =>
      certificateSigningClient
        ? createAdminCertificateRead(
            supabase,
            certificateSigningClient,
            adminId,
            coachProfileId,
            certificateId,
          )
        : Promise.resolve({ data: null, errorCode: "FORBIDDEN" }),
    getVerifiedAdmin: async () => {
      const { data, error } = await supabase.auth.getClaims()
      const claims = error ? null : readVerifiedClaims(data?.claims)
      if (!claims) return { kind: "unauthenticated" }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id,role,status,deleted_at")
        .eq("id", claims.sub)
        .maybeSingle()
      if (profileError || !profile) return { kind: "forbidden" }
      if (profile.role !== "admin" || profile.status !== "active" || profile.deleted_at !== null) {
        return { kind: "forbidden" }
      }
      return { kind: "admin", user: { id: profile.id } }
    },
    listApplications: async (query) => {
      const from = (query.page - 1) * query.pageSize
      const {
        count,
        data: coaches,
        error,
      } = await supabase
        .from("coach_profiles")
        .select("*", { count: "exact" })
        .eq("status", query.status)
        .order("submitted_at", { ascending: true, nullsFirst: false })
        .range(from, from + query.pageSize - 1)
      if (error) return { data: null, errorCode: error.code }
      const rows = coaches ?? []
      const related = await readRelatedRows(supabase, rows)
      if (related.errorCode) return { data: null, errorCode: related.errorCode }

      return {
        data: {
          items: rows.map((coach) => ({
            certificateCount: related.certificateCounts.get(coach.id) ?? 0,
            displayName: related.displayNames.get(coach.user_id) ?? "이름 미등록",
            headline: coach.headline,
            id: coach.id,
            reviewedAt: coach.reviewed_at,
            serviceRegion: coach.service_region,
            sportName: coach.primary_sport_id
              ? (related.sportNames.get(coach.primary_sport_id) ?? null)
              : null,
            status: coach.status,
            submittedAt: coach.submitted_at,
          })),
          page: query.page,
          pageSize: query.pageSize,
          status: query.status,
          total: count ?? 0,
        },
        errorCode: null,
      }
    },
    readApplication: (coachProfileId) => readApplication(supabase, coachProfileId),
    reviewApplication: async (coachProfileId, decision, rejectionReason) => {
      const { data, error } = await supabase.rpc("review_coach_application", {
        checked_coach_profile_id: coachProfileId,
        checked_decision: decision,
        checked_rejection_reason: rejectionReason,
      })
      const row = data?.[0]
      if (error || !row) return { data: null, errorCode: normalizeRpcError(error) }
      if (row.coach_status !== "approved" && row.coach_status !== "rejected") {
        return { data: null, errorCode: "COACH_APPLICATION_CONFLICT" }
      }
      if (row.profile_status !== "active" && row.profile_status !== "coach_approved") {
        return { data: null, errorCode: "COACH_APPLICATION_CONFLICT" }
      }
      return {
        data: {
          coachProfileId: row.coach_profile_id,
          coachStatus: row.coach_status,
          idempotent: row.idempotent,
          profileStatus: row.profile_status,
          reviewedAt: row.reviewed_at,
        },
        errorCode: null,
      }
    },
  }
}

async function readRelatedRows(supabase: SupabaseAppClient, coaches: readonly CoachProfileRow[]) {
  const userIds = coaches.map((coach) => coach.user_id)
  const sportIds = coaches.flatMap((coach) =>
    coach.primary_sport_id ? [coach.primary_sport_id] : [],
  )
  const coachIds = coaches.map((coach) => coach.id)
  if (coaches.length === 0) {
    return {
      certificateCounts: new Map<string, number>(),
      displayNames: new Map<string, string>(),
      errorCode: null,
      sportNames: new Map<string, string>(),
    }
  }
  const [profiles, sports, certificates] = await Promise.all([
    supabase.from("profiles").select("id,display_name").in("id", userIds),
    sportIds.length > 0
      ? supabase.from("sports").select("id,name").in("id", sportIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("coach_certificates").select("coach_profile_id").in("coach_profile_id", coachIds),
  ])
  const firstError = profiles.error ?? sports.error ?? certificates.error
  const certificateCounts = new Map<string, number>()
  for (const certificate of certificates.data ?? []) {
    certificateCounts.set(
      certificate.coach_profile_id,
      (certificateCounts.get(certificate.coach_profile_id) ?? 0) + 1,
    )
  }
  return {
    certificateCounts,
    displayNames: new Map(
      (profiles.data ?? []).map((profile) => [profile.id, profile.display_name]),
    ),
    errorCode: firstError?.code ?? null,
    sportNames: new Map((sports.data ?? []).map((sport) => [sport.id, sport.name])),
  }
}

async function readApplication(supabase: SupabaseAppClient, coachProfileId: string) {
  const { data: coach, error } = await supabase
    .from("coach_profiles")
    .select("*")
    .eq("id", coachProfileId)
    .maybeSingle()
  if (error) return { data: null, errorCode: error.code }
  if (!coach) return { data: null, errorCode: "COACH_APPLICATION_NOT_FOUND" }

  const [profile, sport, certificates] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", coach.user_id).maybeSingle(),
    coach.primary_sport_id
      ? supabase.from("sports").select("name").eq("id", coach.primary_sport_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("coach_certificates")
      .select("id,certificate_name,certificate_number,issuer,verified_at")
      .eq("coach_profile_id", coach.id)
      .order("created_at", { ascending: true }),
  ])
  const firstError = profile.error ?? sport.error ?? certificates.error
  if (firstError) return { data: null, errorCode: firstError.code }
  if (!profile.data) return { data: null, errorCode: "COACH_APPLICATION_NOT_FOUND" }

  return {
    data: {
      bankAccountLast4: coach.bank_account_last4,
      bankName: coach.bank_name,
      bio: coach.bio,
      careerYears: coach.career_years,
      certificates: (certificates.data ?? []).map((certificate) => ({
        certificateName: certificate.certificate_name,
        certificateNumber: certificate.certificate_number,
        id: certificate.id,
        issuer: certificate.issuer,
        verifiedAt: certificate.verified_at,
      })),
      displayName: profile.data.display_name,
      headline: coach.headline,
      id: coach.id,
      payoutHolderName: coach.payout_holder_name,
      rejectionReason: coach.rejection_reason,
      reviewedAt: coach.reviewed_at,
      serviceRegion: coach.service_region,
      sportName: sport.data?.name ?? null,
      status: coach.status,
      submittedAt: coach.submitted_at,
    },
    errorCode: null,
  }
}

function normalizeRpcError(error: Readonly<{ code: string; message: string }> | null) {
  if (!error) return "INTERNAL_ERROR"
  return error.code === "P0001" && REVIEW_RPC_ERRORS.has(error.message) ? error.message : error.code
}
