import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/supabase/database.types"

type ReservationStatus = Database["public"]["Enums"]["reservation_status"]
type PaymentStatus = Database["public"]["Enums"]["payment_status"]
type RefundStatus = Database["public"]["Enums"]["refund_status"]

export type ReservationBadgeTone = "error" | "neutral" | "success" | "warning"
export type ReservationFilter =
  | "all"
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show"
  | "disputed"

export const RESERVATIONS_PER_PAGE = 20

export const RESERVATION_FILTERS: readonly Readonly<{
  label: string
  value: ReservationFilter
}>[] = [
  { label: "전체", value: "all" },
  { label: "결제 대기", value: "pending" },
  { label: "예약 확정", value: "confirmed" },
  { label: "완료", value: "completed" },
  { label: "취소", value: "cancelled" },
  { label: "노쇼", value: "no_show" },
  { label: "분쟁", value: "disputed" },
]

const statusPresentation: Record<
  ReservationStatus,
  Readonly<{ label: string; tone: ReservationBadgeTone }>
> = {
  cancelled_by_admin: { label: "관리자 취소", tone: "neutral" },
  cancelled_by_coach: { label: "지도자 취소", tone: "warning" },
  cancelled_by_user: { label: "학습자 취소", tone: "neutral" },
  completed: { label: "수업 완료", tone: "success" },
  confirmed: { label: "예약 확정", tone: "success" },
  disputed: { label: "분쟁 중", tone: "error" },
  no_show_coach: { label: "지도자 노쇼", tone: "warning" },
  no_show_user: { label: "학습자 노쇼", tone: "warning" },
  pending_payment: { label: "결제 대기", tone: "warning" },
}

const filterStatuses: Record<Exclude<ReservationFilter, "all">, readonly ReservationStatus[]> = {
  cancelled: ["cancelled_by_user", "cancelled_by_coach", "cancelled_by_admin"],
  completed: ["completed"],
  confirmed: ["confirmed"],
  disputed: ["disputed"],
  no_show: ["no_show_user", "no_show_coach"],
  pending: ["pending_payment"],
}

const paymentLabels: Record<PaymentStatus, string> = {
  cancelled: "결제 취소",
  failed: "결제 실패",
  paid: "결제 완료",
  partially_refunded: "부분 환불",
  ready: "결제 준비됨",
  refunded: "결제 환불됨",
}

const refundLabels: Record<RefundStatus, string> = {
  approved: "승인",
  completed: "완료",
  failed: "실패",
  requested: "요청됨",
}

const scheduleFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
})

type ReservationSnapshot = Readonly<{
  coachProfileId: string
  createdAt: string
  id: string
  lessonId: string
  lessonScheduleId: string
  paymentExpiresAt: string | null
  reservedPriceAmount: number
  status: ReservationStatus
}>

type LessonSnapshot = Readonly<{
  address: string | null
  cancellationPolicySummary: string | null
  coachProfileId: string
  id: string
  placeName: string | null
  region: string
  title: string
}>

type ScheduleSnapshot = Readonly<{
  endsAt: string
  id: string
  startsAt: string
}>

type PaymentSnapshot = Readonly<{
  amount: number
  provider: string
  reservationId: string
  status: PaymentStatus
}>

type RefundSnapshot = Readonly<{
  amount: number
  reservationId: string
  status: RefundStatus
}>

type CoachSnapshot = Readonly<{
  displayName: string
  id: string
}>

type ReservationEnrichment = Readonly<{
  coaches: readonly CoachSnapshot[]
  lessons: readonly LessonSnapshot[]
  payments: readonly PaymentSnapshot[]
  refunds: readonly RefundSnapshot[]
  schedules: readonly ScheduleSnapshot[]
}>

export type ReservationListReadSnapshot = Readonly<
  | ({
      kind: "found"
      reservations: readonly ReservationSnapshot[]
      totalCount: number
    } & ReservationEnrichment)
  | { kind: "read_failure" }
>

export type ReservationDetailReadSnapshot = Readonly<
  | ({ kind: "found"; reservation: ReservationSnapshot } & ReservationEnrichment)
  | { kind: "not_found" }
  | { kind: "read_failure" }
>

export type ReservationSummaryView = Readonly<{
  amountText: string
  canContinuePayment: boolean
  id: string
  lessonTitle: string
  location: string
  paymentSummary: string
  refundSummary: string | null
  scheduleLabel: string
  status: Readonly<{ label: string; tone: ReservationBadgeTone }>
}>

export type ReservationDetailView = ReservationSummaryView &
  Readonly<{
    cancellation: Readonly<{
      availableByStatus: boolean
      estimatedRefundAmount: number | null
      estimatedRefundText: string
      storedPolicySummary: string | null
    }>
    coachName: string | null
  }>

export type ReservationListData = Readonly<{
  state: "empty" | "read_failure" | "ready"
  viewModel: Readonly<{
    filter: ReservationFilter
    items: readonly ReservationSummaryView[]
    page: number
    totalCount: number
    totalPages: number
  }> | null
}>

export type ReservationDetailData = Readonly<{
  state: "not_found" | "read_failure" | "ready"
  viewModel: ReservationDetailView | null
}>

export type ReservationListRead = (
  learnerId: string,
  filter: ReservationFilter,
  page: number,
) => Promise<ReservationListReadSnapshot>

export type ReservationDetailRead = (
  reservationId: string,
  learnerId: string,
) => Promise<ReservationDetailReadSnapshot>

export function normalizeReservationFilter(
  value: string | string[] | undefined,
): ReservationFilter {
  const candidate = typeof value === "string" ? value : "all"
  return RESERVATION_FILTERS.some((filter) => filter.value === candidate)
    ? (candidate as ReservationFilter)
    : "all"
}

export function normalizeReservationPage(value: string | string[] | undefined): number {
  if (typeof value !== "string" || !/^\d+$/u.test(value)) return 1
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}

export function getReservationStatusPresentation(status: ReservationStatus) {
  return statusPresentation[status]
}

export function reservationStatusesForFilter(
  filter: ReservationFilter,
): readonly ReservationStatus[] | null {
  return filter === "all" ? null : filterStatuses[filter]
}

export function canContinueReservationPayment(
  reservation: Pick<ReservationSnapshot, "paymentExpiresAt" | "status">,
  payment: Pick<PaymentSnapshot, "provider" | "status"> | null,
  now: Date,
): boolean {
  if (reservation.status !== "pending_payment") return false
  const expiresAt = reservation.paymentExpiresAt
    ? new Date(reservation.paymentExpiresAt).getTime()
    : Number.NaN
  if (!Number.isFinite(expiresAt) || !Number.isFinite(now.getTime())) return false
  if (expiresAt <= now.getTime()) return false
  return payment === null || (payment.status === "ready" && payment.provider === "toss")
}

export async function readReservationListData(
  learnerId: string,
  filter: ReservationFilter,
  page: number,
  read: ReservationListRead = readReservationListSnapshot,
  now: Date = new Date(),
): Promise<ReservationListData> {
  let snapshot: ReservationListReadSnapshot
  try {
    snapshot = await read(learnerId, filter, page)
  } catch {
    snapshot = { kind: "read_failure" }
  }

  if (snapshot.kind === "read_failure") {
    return { state: "read_failure", viewModel: null }
  }

  const items = snapshot.reservations.map((reservation) =>
    buildSummaryView(reservation, snapshot, now),
  )
  const totalPages = Math.max(1, Math.ceil(snapshot.totalCount / RESERVATIONS_PER_PAGE))

  return {
    state: items.length === 0 ? "empty" : "ready",
    viewModel: {
      filter,
      items,
      page,
      totalCount: snapshot.totalCount,
      totalPages,
    },
  }
}

export async function readReservationDetailData(
  reservationId: string,
  learnerId: string,
  read: ReservationDetailRead = readReservationDetailSnapshot,
  now: Date = new Date(),
): Promise<ReservationDetailData> {
  let snapshot: ReservationDetailReadSnapshot
  try {
    snapshot = await read(reservationId, learnerId)
  } catch {
    snapshot = { kind: "read_failure" }
  }

  if (snapshot.kind !== "found") {
    return { state: snapshot.kind, viewModel: null }
  }

  const summary = buildSummaryView(snapshot.reservation, snapshot, now)
  const lesson = snapshot.lessons.find((item) => item.id === snapshot.reservation.lessonId)
  const coach = snapshot.coaches.find((item) => item.id === snapshot.reservation.coachProfileId)
  const schedule = snapshot.schedules.find(
    (item) => item.id === snapshot.reservation.lessonScheduleId,
  )

  return {
    state: "ready",
    viewModel: {
      ...summary,
      cancellation: deriveCancellationInfo(
        snapshot.reservation.status,
        snapshot.reservation.reservedPriceAmount,
        schedule?.startsAt ?? null,
        lesson?.cancellationPolicySummary ?? null,
        now,
      ),
      coachName: coach?.displayName ?? null,
    },
  }
}

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
        .select("id,title,region,place_name,address,cancellation_policy_summary,coach_profile_id")
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

function buildSummaryView(
  reservation: ReservationSnapshot,
  enrichment: ReservationEnrichment,
  now: Date,
): ReservationSummaryView {
  const lesson = enrichment.lessons.find((item) => item.id === reservation.lessonId)
  const schedule = enrichment.schedules.find((item) => item.id === reservation.lessonScheduleId)
  const payment = enrichment.payments.find((item) => item.reservationId === reservation.id) ?? null
  const refund = enrichment.refunds.find((item) => item.reservationId === reservation.id) ?? null
  const canContinuePayment = canContinueReservationPayment(reservation, payment, now)
  const paymentSummary =
    payment?.status === "refunded" && refund
      ? "결제 처리됨"
      : formatPaymentSummary(reservation, payment, canContinuePayment, now)

  return {
    amountText: `${reservation.reservedPriceAmount.toLocaleString("ko-KR")}원`,
    canContinuePayment,
    id: reservation.id,
    lessonTitle: lesson?.title ?? "레슨 정보 확인 필요",
    location: formatLocation(lesson?.region ?? null, lesson?.placeName ?? lesson?.address ?? null),
    paymentSummary,
    refundSummary: refund
      ? `환불 ${refund.amount.toLocaleString("ko-KR")}원 · ${refundLabels[refund.status]}`
      : null,
    scheduleLabel: schedule
      ? formatScheduleLabel(schedule.startsAt, schedule.endsAt)
      : "일정 정보 확인 필요",
    status: getReservationStatusPresentation(reservation.status),
  }
}

function formatPaymentSummary(
  reservation: ReservationSnapshot,
  payment: PaymentSnapshot | null,
  canContinuePayment: boolean,
  now: Date,
): string {
  if (reservation.status !== "pending_payment") {
    return payment ? paymentLabels[payment.status] : "결제 내역 없음"
  }

  if (canContinuePayment) {
    return payment ? paymentLabels[payment.status] : "결제 준비 전"
  }

  const expiresAt = reservation.paymentExpiresAt
    ? new Date(reservation.paymentExpiresAt).getTime()
    : Number.NaN
  if (Number.isFinite(expiresAt) && Number.isFinite(now.getTime()) && expiresAt <= now.getTime()) {
    return "결제 기한 만료"
  }

  return "결제 준비 불가"
}

function deriveCancellationInfo(
  status: ReservationStatus,
  amount: number,
  startsAt: string | null,
  storedPolicySummary: string | null,
  now: Date,
): ReservationDetailView["cancellation"] {
  if (status !== "pending_payment" && status !== "confirmed") {
    return {
      availableByStatus: false,
      estimatedRefundAmount: null,
      estimatedRefundText: "현재 예약 상태에서는 취소 요청 대상이 아니에요.",
      storedPolicySummary,
    }
  }

  if (status === "pending_payment") {
    return {
      availableByStatus: true,
      estimatedRefundAmount: 0,
      estimatedRefundText: "결제 전 예약으로 환불 대상 결제액이 없어요.",
      storedPolicySummary,
    }
  }

  const scheduleTime = startsAt ? new Date(startsAt).getTime() : Number.NaN
  if (!Number.isFinite(scheduleTime) || !Number.isFinite(now.getTime())) {
    return {
      availableByStatus: true,
      estimatedRefundAmount: null,
      estimatedRefundText: "일정 정보가 없어 예상 환불액을 계산할 수 없어요.",
      storedPolicySummary,
    }
  }

  const remainingMilliseconds = scheduleTime - now.getTime()
  const ratio =
    remainingMilliseconds >= 24 * 60 * 60 * 1000
      ? 0.7
      : remainingMilliseconds >= 3 * 60 * 60 * 1000
        ? 0.5
        : 0
  const estimatedRefundAmount = Math.floor(amount * ratio)

  return {
    availableByStatus: true,
    estimatedRefundAmount,
    estimatedRefundText: `현재 시각 기준 예상 환불액 ${estimatedRefundAmount.toLocaleString("ko-KR")}원`,
    storedPolicySummary,
  }
}

function formatScheduleLabel(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt)
  const end = new Date(endsAt)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return "일정 정보 확인 필요"
  }
  return `${scheduleFormatter.format(start)} - ${scheduleFormatter.format(end)}`
}

function formatLocation(region: string | null, place: string | null): string {
  if (region && place) return `${region} · ${place}`
  return region ?? place ?? "장소 정보 확인 필요"
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
