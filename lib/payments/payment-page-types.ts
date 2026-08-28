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
