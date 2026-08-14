import type { Database } from "@/lib/supabase/database.types"

type ReservationStatus = Database["public"]["Enums"]["reservation_status"]
type PaymentStatus = Database["public"]["Enums"]["payment_status"]

export type PaymentPageState =
  | "pending_valid"
  | "expired_pending"
  | "ready"
  | "confirmed"
  | "terminal"
  | "unavailable"
  | "not_found"
  | "read_failure"

export type PaymentReadyView = Readonly<{
  amount: number
  orderName: string
  paymentId: string
  provider: "toss"
  providerOrderId: string
}>

export type PaymentPageViewModel = Readonly<{
  amount: number
  lesson: Readonly<{
    id: string
    title: string
  }>
  paymentExpiresAt: string | null
  place: string | null
  readyPayment: PaymentReadyView | null
  refundSummary: string | null
  region: string | null
  reservation: Readonly<{
    id: string
    status: ReservationStatus
  }>
  schedule: Readonly<{
    endsAt: string | null
    label: string | null
    startsAt: string | null
  }>
}>

export type PaymentPageData = Readonly<{
  state: PaymentPageState
  viewModel: PaymentPageViewModel | null
}>

type ReservationSnapshot = Readonly<{
  id: string
  learnerId: string
  lessonId: string
  lessonScheduleId: string
  paymentExpiresAt: string | null
  reservedPriceAmount: number
  status: ReservationStatus
}>

type LessonSnapshot = Readonly<{
  address: string | null
  cancellationPolicySummary: string | null
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
  id: string
  provider: string
  providerOrderId: string
  status: PaymentStatus
}>

export type PaymentPageReadSnapshot = Readonly<
  | {
      kind: "found"
      lesson: LessonSnapshot | null
      payment: PaymentSnapshot | null
      reservation: ReservationSnapshot
      schedule: ScheduleSnapshot | null
    }
  | { kind: "not_found" }
  | { kind: "read_failure" }
>

export type PaymentPageRead = (
  reservationId: string,
  learnerId: string,
) => Promise<PaymentPageReadSnapshot>

const terminalReservationStatuses = new Set<ReservationStatus>([
  "cancelled_by_user",
  "cancelled_by_coach",
  "cancelled_by_admin",
  "completed",
  "no_show_user",
  "no_show_coach",
  "disputed",
])

const terminalPaymentStatuses = new Set<PaymentStatus>([
  "failed",
  "cancelled",
  "partially_refunded",
  "refunded",
])

const scheduleFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
})

export function classifyPaymentPageState(
  snapshot: PaymentPageReadSnapshot,
  now: Date,
): PaymentPageState {
  if (snapshot.kind !== "found") {
    return snapshot.kind
  }

  const { payment, reservation } = snapshot

  if (reservation.status === "confirmed" || payment?.status === "paid") {
    return "confirmed"
  }

  if (
    terminalReservationStatuses.has(reservation.status) ||
    (payment !== null && terminalPaymentStatuses.has(payment.status))
  ) {
    return "terminal"
  }

  if (reservation.status !== "pending_payment") {
    return "unavailable"
  }

  const expiresAt = reservation.paymentExpiresAt
    ? new Date(reservation.paymentExpiresAt).getTime()
    : Number.NaN

  if (!Number.isFinite(expiresAt) || !Number.isFinite(now.getTime())) {
    return "unavailable"
  }

  if (expiresAt <= now.getTime()) {
    return "expired_pending"
  }

  if (!payment) {
    return "pending_valid"
  }

  return payment.status === "ready" && payment.provider === "toss" ? "ready" : "unavailable"
}

export async function readPaymentPageData(
  reservationId: string,
  learnerId: string,
  read: PaymentPageRead = readPaymentPageSnapshot,
  now: Date = new Date(),
): Promise<PaymentPageData> {
  let snapshot: PaymentPageReadSnapshot

  try {
    snapshot = await read(reservationId, learnerId)
  } catch {
    snapshot = { kind: "read_failure" }
  }

  const state = classifyPaymentPageState(snapshot, now)

  return {
    state,
    viewModel: snapshot.kind === "found" ? buildViewModel(snapshot, state) : null,
  }
}

export async function readPaymentPageSnapshot(
  reservationId: string,
  learnerId: string,
): Promise<PaymentPageReadSnapshot> {
  try {
    const [{ createSupabaseServerComponentClient }, { createSupabaseServiceClient }] =
      await Promise.all([import("@/lib/auth/server-profile"), import("@/lib/supabase/server")])
    const supabase = await createSupabaseServerComponentClient()
    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select(
        "id,learner_id,lesson_id,lesson_schedule_id,payment_expires_at,reserved_price_amount,status",
      )
      .eq("id", reservationId)
      .eq("learner_id", learnerId)
      .maybeSingle()

    if (reservationError) {
      return { kind: "read_failure" }
    }

    if (!reservation) {
      return { kind: "not_found" }
    }

    // The session-scoped reservation query above proves learner ownership. Related
    // lesson and schedule rows may no longer be public after a valid reservation.
    const serviceSupabase = createSupabaseServiceClient()
    const [lessonResult, scheduleResult, paymentResult] = await Promise.all([
      serviceSupabase
        .from("lessons")
        .select("id,title,place_name,address,region,cancellation_policy_summary")
        .eq("id", reservation.lesson_id)
        .maybeSingle(),
      serviceSupabase
        .from("lesson_schedules")
        .select("id,starts_at,ends_at")
        .eq("id", reservation.lesson_schedule_id)
        .maybeSingle(),
      supabase
        .from("payments")
        .select("id,reservation_id,payer_id,status,amount,provider,provider_order_id")
        .eq("reservation_id", reservation.id)
        .eq("payer_id", learnerId)
        .maybeSingle(),
    ])

    if (lessonResult.error || scheduleResult.error || paymentResult.error) {
      return { kind: "read_failure" }
    }

    return {
      kind: "found",
      lesson: lessonResult.data
        ? {
            address: lessonResult.data.address,
            cancellationPolicySummary: lessonResult.data.cancellation_policy_summary,
            id: lessonResult.data.id,
            placeName: lessonResult.data.place_name,
            region: lessonResult.data.region,
            title: lessonResult.data.title,
          }
        : null,
      payment: paymentResult.data
        ? {
            amount: paymentResult.data.amount,
            id: paymentResult.data.id,
            provider: paymentResult.data.provider,
            providerOrderId: paymentResult.data.provider_order_id,
            status: paymentResult.data.status,
          }
        : null,
      reservation: {
        id: reservation.id,
        learnerId: reservation.learner_id,
        lessonId: reservation.lesson_id,
        lessonScheduleId: reservation.lesson_schedule_id,
        paymentExpiresAt: reservation.payment_expires_at,
        reservedPriceAmount: reservation.reserved_price_amount,
        status: reservation.status,
      },
      schedule: scheduleResult.data
        ? {
            endsAt: scheduleResult.data.ends_at,
            id: scheduleResult.data.id,
            startsAt: scheduleResult.data.starts_at,
          }
        : null,
    }
  } catch {
    return { kind: "read_failure" }
  }
}

function buildViewModel(
  snapshot: Extract<PaymentPageReadSnapshot, { kind: "found" }>,
  state: PaymentPageState,
) {
  const { lesson, payment, reservation, schedule } = snapshot
  const readyPayment =
    state === "ready" && payment?.status === "ready" && payment.provider === "toss" && lesson
      ? {
          amount: payment.amount,
          orderName: lesson.title,
          paymentId: payment.id,
          provider: "toss" as const,
          providerOrderId: payment.providerOrderId,
        }
      : null

  return {
    amount: reservation.reservedPriceAmount,
    lesson: {
      id: lesson?.id ?? reservation.lessonId,
      title: lesson?.title ?? "레슨 정보 확인 필요",
    },
    paymentExpiresAt: reservation.paymentExpiresAt,
    place: lesson?.placeName ?? lesson?.address ?? null,
    readyPayment,
    refundSummary: lesson?.cancellationPolicySummary ?? null,
    region: lesson?.region ?? null,
    reservation: {
      id: reservation.id,
      status: reservation.status,
    },
    schedule: {
      endsAt: schedule?.endsAt ?? null,
      label: schedule ? formatScheduleLabel(schedule.startsAt, schedule.endsAt) : null,
      startsAt: schedule?.startsAt ?? null,
    },
  } satisfies PaymentPageViewModel
}

function formatScheduleLabel(startsAt: string, endsAt: string) {
  const start = new Date(startsAt)
  const end = new Date(endsAt)

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return null
  }

  return `${scheduleFormatter.format(start)} - ${scheduleFormatter.format(end)}`
}
