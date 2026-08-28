import type { SupabaseAppClient } from "../supabase/server"

export type DashboardLessonRow = Readonly<{ id: string; title: string }>
export type DashboardSettlementRow = Readonly<{ net_amount: number }>
export type DashboardReviewRow = Readonly<{
  content: string | null
  created_at: string
  lesson_id: string
  rating: number
}>
export type DashboardNotificationRow = Readonly<{
  body: string | null
  created_at: string
  title: string
}>

type DashboardRepositoryInput = Readonly<{
  client: SupabaseAppClient
  coachProfileId: string
  endExclusive: string
  profileId: string
  start: string
}>

export type DashboardRepositoryRows = Readonly<{
  lessons: readonly DashboardLessonRow[]
  notifications: readonly DashboardNotificationRow[]
  reservationStatuses: readonly Readonly<{ status: string }>[]
  reviews: readonly DashboardReviewRow[]
  schedules: readonly Readonly<{
    capacity: number
    ends_at: string
    id: string
    is_open: boolean
    lesson_id: string
    reserved_count: number
    starts_at: string
  }>[]
  settlements: readonly DashboardSettlementRow[]
  unreadNotificationCount: number
}>

export class CoachDashboardRepositoryError extends Error {}

export async function readCoachDashboardRows(
  input: DashboardRepositoryInput,
): Promise<DashboardRepositoryRows> {
  const lessonsResult = await input.client
    .from("lessons")
    .select("id,title")
    .eq("coach_profile_id", input.coachProfileId)
  const lessons = requireRows(lessonsResult)
  const lessonIds = lessons.map((lesson) => lesson.id)

  const [
    schedulesResult,
    reservationsResult,
    settlementsResult,
    reviewsResult,
    notificationsResult,
  ] = await Promise.all([
    input.client
      .from("lesson_schedules")
      .select("capacity,ends_at,id,is_open,lesson_id,reserved_count,starts_at")
      .in("lesson_id", lessonIds)
      .gte("starts_at", input.start)
      .lt("starts_at", input.endExclusive)
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(8),
    input.client
      .from("reservations")
      .select("status")
      .eq("coach_profile_id", input.coachProfileId)
      .in("status", ["pending_payment", "confirmed"]),
    input.client
      .from("settlements")
      .select("net_amount")
      .eq("coach_profile_id", input.coachProfileId)
      .eq("status", "pending"),
    input.client
      .from("reviews")
      .select("rating,content,created_at,lesson_id")
      .eq("coach_profile_id", input.coachProfileId)
      .eq("status", "visible")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(3),
    input.client
      .from("notifications")
      .select("title,body,created_at", { count: "exact" })
      .eq("user_id", input.profileId)
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(3),
  ])

  const unreadNotificationCount = notificationsResult.count
  if (
    unreadNotificationCount === null ||
    !Number.isSafeInteger(unreadNotificationCount) ||
    unreadNotificationCount < 0
  ) {
    throw new CoachDashboardRepositoryError()
  }

  return {
    lessons,
    notifications: requireRows(notificationsResult),
    reservationStatuses: requireRows(reservationsResult),
    reviews: requireRows(reviewsResult),
    schedules: requireRows(schedulesResult),
    settlements: requireRows(settlementsResult),
    unreadNotificationCount,
  }
}

function requireRows<Row>(
  result: Readonly<{ data: Row[] | null; error: unknown }>,
): readonly Row[] {
  if (result.error !== null || result.data === null) throw new CoachDashboardRepositoryError()
  return result.data
}
