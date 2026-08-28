import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import type { Database } from "@/lib/supabase/database.types"

export const ADMIN_RESERVATION_ACTIONS = [
  "complete",
  "mark_learner_no_show",
  "mark_coach_no_show",
  "open_dispute",
  "cancel",
] as const
export type AdminReservationAction = (typeof ADMIN_RESERVATION_ACTIONS)[number]
export const adminReservationStatusSchema = z.strictObject({
  action: z.enum(ADMIN_RESERVATION_ACTIONS),
  reason: z.string().trim().min(1).max(200).nullable().optional(),
})

const pageSchema = z.coerce.number().int().min(1).max(10000).default(1)
const pageSizeSchema = z.coerce.number().int().min(1).max(100).default(20)
const statuses = [
  "pending_payment",
  "confirmed",
  "cancelled_by_user",
  "cancelled_by_coach",
  "cancelled_by_admin",
  "completed",
  "no_show_user",
  "no_show_coach",
  "disputed",
] as const

export type AdminReservationQuery = Readonly<{
  page: number
  pageSize: number
  status: (typeof statuses)[number] | "all"
}>

export function parseAdminReservationQuery(searchParams: URLSearchParams) {
  const result = z
    .object({
      page: pageSchema,
      pageSize: pageSizeSchema,
      status: z.enum(["all", ...statuses]).default("all"),
    })
    .safeParse(Object.fromEntries(searchParams))
  return result.success ? result.data : null
}

export type AdminReservation = Readonly<{
  amount: number
  coachName: string | null
  createdAt: string
  id: string
  learnerName: string | null
  lessonTitle: string | null
  paymentStatus: string | null
  refundStatus: string | null
  scheduleEndsAt: string | null
  scheduleStartsAt: string | null
  status: Database["public"]["Enums"]["reservation_status"]
}>

export type AdminReservationPage = Readonly<{
  items: readonly AdminReservation[]
  page: number
  pageSize: number
  total: number
}>

export type AdminReservationResult<T> = Readonly<{ data: T | null; errorCode: string | null }>

export type AdminReservationDependencies = Readonly<{
  getAccess: () => Promise<Readonly<{ kind: "admin" | "forbidden" | "unauthenticated" }>>
  listReservations: (
    query: AdminReservationQuery,
  ) => Promise<AdminReservationResult<AdminReservationPage>>
  readReservation: (reservationId: string) => Promise<AdminReservationResult<AdminReservation>>
  transitionReservation: (
    reservationId: string,
    action: AdminReservationAction,
    reason: string | null,
  ) => Promise<AdminReservationResult<AdminReservationStatus>>
}>

export type AdminReservationStatus = Readonly<{
  idempotent: boolean
  refundId: string | null
  refundStatus: string | null
  reservationId: string
  status: Database["public"]["Enums"]["reservation_status"]
}>

export function createAdminReservationDependencies(
  client: SupabaseClient<Database>,
): AdminReservationDependencies {
  return {
    getAccess: async () => {
      const claims = await client.auth.getClaims()
      const userId = typeof claims.data?.claims.sub === "string" ? claims.data.claims.sub : null
      if (claims.error || !userId) return { kind: "unauthenticated" }
      const profile = await client
        .from("profiles")
        .select("role,status,deleted_at")
        .eq("id", userId)
        .maybeSingle()
      if (
        profile.error ||
        !profile.data ||
        profile.data.role !== "admin" ||
        profile.data.status !== "active" ||
        profile.data.deleted_at !== null
      ) {
        return { kind: "forbidden" }
      }
      return { kind: "admin" }
    },
    listReservations: (query) => readReservations(client, query),
    readReservation: async (reservationId) => {
      const result = await readReservations(
        client,
        { page: 1, pageSize: 1, status: "all" },
        reservationId,
      )
      return result.data?.items[0]
        ? { data: result.data.items[0], errorCode: null }
        : { data: null, errorCode: result.errorCode ?? "P0002" }
    },
    transitionReservation: async (reservationId, action, reason) => {
      const result = await client.rpc("transition_admin_reservation", {
        checked_action: action,
        checked_reason: reason,
        checked_reservation_id: reservationId,
      })
      const row = result.data?.length === 1 ? result.data[0] : null
      return row
        ? {
            data: {
              idempotent: row.idempotent,
              refundId: row.refund_id,
              refundStatus: row.refund_status,
              reservationId: row.reservation_id,
              status: row.reservation_status,
            },
            errorCode: null,
          }
        : { data: null, errorCode: result.error?.code ?? "INTERNAL_ERROR" }
    },
  }
}

async function readReservations(
  client: SupabaseClient<Database>,
  query: AdminReservationQuery,
  onlyId?: string,
): Promise<AdminReservationResult<AdminReservationPage>> {
  let request = client
    .from("reservations")
    .select(
      "id,learner_id,coach_profile_id,lesson_id,lesson_schedule_id,status,reserved_price_amount,created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
  if (query.status !== "all") request = request.eq("status", query.status)
  if (onlyId) request = request.eq("id", onlyId)
  else request = request.range((query.page - 1) * query.pageSize, query.page * query.pageSize - 1)
  const result = await request
  if (result.error) return { data: null, errorCode: result.error.code }
  const rows = result.data ?? []
  const learnerIds = [...new Set(rows.map((row) => row.learner_id))]
  const coachIds = [...new Set(rows.map((row) => row.coach_profile_id))]
  const lessonIds = [...new Set(rows.map((row) => row.lesson_id))]
  const scheduleIds = [...new Set(rows.map((row) => row.lesson_schedule_id))]
  const [learners, coaches, lessons, schedules, payments, refunds] = await Promise.all([
    client.from("profiles").select("id,display_name").in("id", learnerIds),
    client.from("coach_profiles").select("id,user_id").in("id", coachIds),
    client.from("lessons").select("id,title").in("id", lessonIds),
    client.from("lesson_schedules").select("id,starts_at,ends_at").in("id", scheduleIds),
    client
      .from("payments")
      .select("reservation_id,status")
      .in(
        "reservation_id",
        rows.map((row) => row.id),
      ),
    client
      .from("refunds")
      .select("reservation_id,status")
      .in(
        "reservation_id",
        rows.map((row) => row.id),
      ),
  ])
  if ([learners, coaches, lessons, schedules, payments, refunds].some((item) => item.error)) {
    return { data: null, errorCode: "INTERNAL_ERROR" }
  }
  const coachUserIds = new Set((coaches.data ?? []).map((coach) => coach.user_id))
  const coachUsers = await client
    .from("profiles")
    .select("id,display_name")
    .in("id", [...coachUserIds])
  if (coachUsers.error) return { data: null, errorCode: "INTERNAL_ERROR" }
  const learnerMap = new Map((learners.data ?? []).map((item) => [item.id, item.display_name]))
  const coachMap = new Map((coaches.data ?? []).map((item) => [item.id, item.user_id]))
  const coachUserMap = new Map((coachUsers.data ?? []).map((item) => [item.id, item.display_name]))
  const lessonMap = new Map((lessons.data ?? []).map((item) => [item.id, item.title]))
  const scheduleMap = new Map((schedules.data ?? []).map((item) => [item.id, item]))
  const paymentMap = new Map(
    (payments.data ?? []).map((item) => [item.reservation_id, item.status]),
  )
  const refundMap = new Map((refunds.data ?? []).map((item) => [item.reservation_id, item.status]))
  const items = rows.map((row) => {
    const schedule = scheduleMap.get(row.lesson_schedule_id)
    return {
      amount: row.reserved_price_amount,
      coachName: row.coach_profile_id
        ? (coachUserMap.get(coachMap.get(row.coach_profile_id) ?? "") ?? null)
        : null,
      createdAt: row.created_at,
      id: row.id,
      learnerName: learnerMap.get(row.learner_id) ?? null,
      lessonTitle: lessonMap.get(row.lesson_id) ?? null,
      paymentStatus: paymentMap.get(row.id) ?? null,
      refundStatus: refundMap.get(row.id) ?? null,
      scheduleEndsAt: schedule?.ends_at ?? null,
      scheduleStartsAt: schedule?.starts_at ?? null,
      status: row.status,
    }
  })
  return {
    data: {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total: result.count ?? items.length,
    },
    errorCode: null,
  }
}
