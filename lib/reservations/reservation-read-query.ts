import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/supabase/database.types"
import {
  RESERVATIONS_PER_PAGE,
  reservationStatusesForFilter,
} from "./reservation-read-presentation"
import type {
  ReservationDetailReadSnapshot,
  ReservationEnrichment,
  ReservationFilter,
  ReservationListReadSnapshot,
  ReservationSnapshot,
  ReservationStatus,
} from "./reservation-read-types"

export async function readReservationListSnapshot(
  learnerId: string,
  filter: ReservationFilter,
  page: number,
): Promise<ReservationListReadSnapshot> {
  try {
    const { createSupabaseServerComponentClient } = await import("@/lib/auth/server-profile")
    const supabase = await createSupabaseServerComponentClient()
    const statuses = reservationStatusesForFilter(filter)
    const firstRow = (page - 1) * RESERVATIONS_PER_PAGE
    const lastRow = firstRow + RESERVATIONS_PER_PAGE - 1
    const ownedQuery = supabase
      .from("reservations")
      .select(
        "id,lesson_id,lesson_schedule_id,coach_profile_id,status,reserved_price_amount,payment_expires_at,created_at",
        { count: "exact" },
      )
      .eq("learner_id", learnerId)
    const filteredQuery = statuses ? ownedQuery.in("status", statuses) : ownedQuery
    const reservationResult = await filteredQuery
      .order("created_at", { ascending: false })
      .range(firstRow, lastRow)

    if (reservationResult.error) return { kind: "read_failure" }

    const reservations = (reservationResult.data ?? []).map(mapReservationSnapshot)
    if (reservations.length === 0) {
      return {
        coaches: [],
        kind: "found",
        lessons: [],
        payments: [],
        refunds: [],
        reservations,
        schedules: [],
        totalCount: reservationResult.count ?? 0,
      }
    }

    const enrichment = await enrichOwnedReservations(supabase, learnerId, reservations)
    if (!enrichment) return { kind: "read_failure" }
    return {
      ...enrichment,
      kind: "found",
      reservations,
      totalCount: reservationResult.count ?? reservations.length,
    }
  } catch {
    return { kind: "read_failure" }
  }
}

export async function readReservationDetailSnapshot(
  reservationId: string,
  learnerId: string,
): Promise<ReservationDetailReadSnapshot> {
  try {
    const { createSupabaseServerComponentClient } = await import("@/lib/auth/server-profile")
    const supabase = await createSupabaseServerComponentClient()
    const reservationResult = await supabase
      .from("reservations")
      .select(
        "id,lesson_id,lesson_schedule_id,coach_profile_id,status,reserved_price_amount,payment_expires_at,created_at",
      )
      .eq("learner_id", learnerId)
      .eq("id", reservationId)
      .maybeSingle()

    if (reservationResult.error) return { kind: "read_failure" }
    if (!reservationResult.data) return { kind: "not_found" }

    const reservation = mapReservationSnapshot(reservationResult.data)
    const enrichment = await enrichOwnedReservations(supabase, learnerId, [reservation])
    if (!enrichment) return { kind: "read_failure" }
    return { ...enrichment, kind: "found", reservation }
  } catch {
    return { kind: "read_failure" }
  }
}

function mapReservationSnapshot(row: {
  coach_profile_id: string
  created_at: string
  id: string
  lesson_id: string
  lesson_schedule_id: string
  payment_expires_at: string | null
  reserved_price_amount: number
  status: ReservationStatus
}): ReservationSnapshot {
  return {
    coachProfileId: row.coach_profile_id,
    createdAt: row.created_at,
    id: row.id,
    lessonId: row.lesson_id,
    lessonScheduleId: row.lesson_schedule_id,
    paymentExpiresAt: row.payment_expires_at,
    reservedPriceAmount: row.reserved_price_amount,
    status: row.status,
  }
}

async function enrichOwnedReservations(
  supabase: SupabaseClient<Database>,
  learnerId: string,
  reservations: readonly ReservationSnapshot[],
): Promise<ReservationEnrichment | null> {
  const { createSupabaseServiceClient } = await import("@/lib/supabase/server")
  const serviceSupabase = createSupabaseServiceClient()
  const reservationIds = unique(reservations.map((reservation) => reservation.id))
  const lessonIds = unique(reservations.map((reservation) => reservation.lessonId))
  const scheduleIds = unique(reservations.map((reservation) => reservation.lessonScheduleId))
  const coachIds = unique(reservations.map((reservation) => reservation.coachProfileId))
  const [lessonResult, scheduleResult, coachResult, paymentResult, refundResult] =
    await Promise.all([
      serviceSupabase
        .from("lessons")
        .select(
          "id,title,region,place_name,address,preparation,cancellation_policy_summary,coach_profile_id",
        )
        .in("id", lessonIds),
      serviceSupabase.from("lesson_schedules").select("id,starts_at,ends_at").in("id", scheduleIds),
      serviceSupabase.from("coach_profiles").select("id,user_id").in("id", coachIds),
      supabase
        .from("payments")
        .select("reservation_id,status,amount,provider")
        .eq("payer_id", learnerId)
        .in("reservation_id", reservationIds),
      supabase
        .from("refunds")
        .select("reservation_id,status,amount,created_at")
        .in("reservation_id", reservationIds)
        .order("created_at", { ascending: false }),
    ])

  if (
    lessonResult.error ||
    scheduleResult.error ||
    coachResult.error ||
    paymentResult.error ||
    refundResult.error
  ) {
    return null
  }

  const coachRows = coachResult.data ?? []
  const coachUserIds = unique(coachRows.map((coach) => coach.user_id))
  const profileResult =
    coachUserIds.length > 0
      ? await serviceSupabase.from("profiles").select("id,display_name").in("id", coachUserIds)
      : { data: [], error: null }
  if (profileResult.error) return null
  const namesByUserId = new Map(
    (profileResult.data ?? []).map((profile) => [profile.id, profile.display_name]),
  )

  return {
    coaches: coachRows.flatMap((coach) => {
      const displayName = namesByUserId.get(coach.user_id)
      return displayName ? [{ displayName, id: coach.id }] : []
    }),
    lessons: (lessonResult.data ?? []).map((lesson) => ({
      address: lesson.address,
      cancellationPolicySummary: lesson.cancellation_policy_summary,
      coachProfileId: lesson.coach_profile_id,
      id: lesson.id,
      placeName: lesson.place_name,
      preparation: lesson.preparation,
      region: lesson.region,
      title: lesson.title,
    })),
    payments: (paymentResult.data ?? []).map((payment) => ({
      amount: payment.amount,
      provider: payment.provider,
      reservationId: payment.reservation_id,
      status: payment.status,
    })),
    refunds: (refundResult.data ?? []).map((refund) => ({
      amount: refund.amount,
      reservationId: refund.reservation_id,
      status: refund.status,
    })),
    schedules: (scheduleResult.data ?? []).map((schedule) => ({
      endsAt: schedule.ends_at,
      id: schedule.id,
      startsAt: schedule.starts_at,
    })),
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
