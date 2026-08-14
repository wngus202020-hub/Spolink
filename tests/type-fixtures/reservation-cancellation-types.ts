import type { Database, Json } from "../../lib/supabase/database.types"

type RefundRow = Database["public"]["Tables"]["refunds"]["Row"]
type CancellationArgs = Database["public"]["Functions"]["cancel_reservation"]["Args"]
type CancellationRow = Database["public"]["Functions"]["cancel_reservation"]["Returns"][number]
type RefundSource = "manual" | "payment_confirmation_reconciliation" | "reservation_cancellation"

export const refundSources = [
  "manual",
  "payment_confirmation_reconciliation",
  "reservation_cancellation",
] satisfies readonly RefundRow["source"][]

export const cancellationArgs = {
  checked_reason: "Schedule conflict",
  checked_reservation_id: "00000000-0000-0000-0000-000000000001",
} satisfies CancellationArgs

export function consumeReservationCancellationTypes(
  refund: RefundRow,
  cancellation: CancellationRow,
): Readonly<{
  cancelledAt: string
  refundAmount: number | null
  refundId: string | null
  refundPayload: Json | null
  refundStatus: Database["public"]["Enums"]["refund_status"] | null
  reservationStatus: Database["public"]["Enums"]["reservation_status"]
  source: RefundSource
}> {
  return {
    cancelledAt: cancellation.cancelled_at,
    refundAmount: cancellation.refund_amount,
    refundId: cancellation.refund_id,
    refundPayload: refund.raw_payload,
    refundStatus: cancellation.refund_status,
    reservationStatus: cancellation.reservation_status,
    source: refund.source,
  }
}
