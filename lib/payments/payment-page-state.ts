import type { Database } from "@/lib/supabase/database.types"
import type { PaymentPageReadSnapshot, PaymentPageState } from "./payment-page-types"

type ReservationStatus = Database["public"]["Enums"]["reservation_status"]
type PaymentStatus = Database["public"]["Enums"]["payment_status"]

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

export function classifyPaymentPageState(
  snapshot: PaymentPageReadSnapshot,
  now: Date,
): PaymentPageState {
  if (snapshot.kind !== "found") {
    return snapshot.kind
  }

  const { payment, reservation } = snapshot

  if (terminalReservationStatuses.has(reservation.status)) {
    return "terminal"
  }

  if (reservation.status === "confirmed" && payment?.status === "paid") {
    return "confirmed"
  }

  if (reservation.status === "confirmed" || payment?.status === "paid") {
    return "unavailable"
  }

  if (payment !== null && terminalPaymentStatuses.has(payment.status)) {
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
