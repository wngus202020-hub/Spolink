import type { Database } from "@/lib/supabase/database.types"

export type ReservationStatus = Database["public"]["Enums"]["reservation_status"]
export type PaymentStatus = Database["public"]["Enums"]["payment_status"]
export type RefundStatus = Database["public"]["Enums"]["refund_status"]

export type ReservationBadgeTone = "error" | "neutral" | "success" | "warning"
export type ReservationFilter =
  | "all"
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show"
  | "disputed"

export type ReservationSnapshot = Readonly<{
  coachProfileId: string
  createdAt: string
  id: string
  lessonId: string
  lessonScheduleId: string
  paymentExpiresAt: string | null
  reservedPriceAmount: number
  status: ReservationStatus
}>

export type LessonSnapshot = Readonly<{
  address: string | null
  cancellationPolicySummary: string | null
  coachProfileId: string
  id: string
  placeName: string | null
  preparation: string | null
  region: string
  title: string
}>

export type ScheduleSnapshot = Readonly<{
  endsAt: string
  id: string
  startsAt: string
}>

export type PaymentSnapshot = Readonly<{
  amount: number
  provider: string
  reservationId: string
  status: PaymentStatus
}>

export type RefundSnapshot = Readonly<{
  amount: number
  reservationId: string
  status: RefundStatus
}>

export type CoachSnapshot = Readonly<{
  displayName: string
  id: string
}>

export type ReservationEnrichment = Readonly<{
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
    endsAt: string | null
    lessonId: string
    paymentStatus: PaymentStatus | null
    preparation: string | null
    reservationStatus: ReservationStatus
    startsAt: string | null
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
