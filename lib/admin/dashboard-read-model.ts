import type { SupabaseAppClient } from "../supabase/server"

export type AdminDashboardCounts = Readonly<{
  coachApplications: number
  lessonReviews: number
  openReports: number
  disputedReservations: number
  heldSettlements: number
}>

export class AdminDashboardReadError extends Error {
  readonly code = "ADMIN_DASHBOARD_READ_FAILED"

  constructor() {
    super("관리자 대시보드 건수를 불러오지 못했습니다.")
    this.name = "AdminDashboardReadError"
  }
}

export async function readAdminDashboardCounts(
  client: SupabaseAppClient,
): Promise<AdminDashboardCounts> {
  const [coachApplications, lessonReviews, openReports, disputedReservations, heldSettlements] =
    await Promise.all([
      client
        .from("coach_profiles")
        .select("id", { count: "exact", head: true })
        .eq("status", "submitted"),
      client
        .from("lessons")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending_review"),
      client
        .from("reports")
        .select("id", { count: "exact", head: true })
        .in("status", ["submitted", "reviewing"]),
      client
        .from("reservations")
        .select("id", { count: "exact", head: true })
        .eq("status", "disputed"),
      client.from("settlements").select("id", { count: "exact", head: true }).eq("status", "hold"),
    ])

  return {
    coachApplications: requireCount(coachApplications),
    lessonReviews: requireCount(lessonReviews),
    openReports: requireCount(openReports),
    disputedReservations: requireCount(disputedReservations),
    heldSettlements: requireCount(heldSettlements),
  }
}

function requireCount(result: Readonly<{ count: number | null; error: unknown }>): number {
  if (result.error !== null || result.count === null) throw new AdminDashboardReadError()
  return result.count
}
