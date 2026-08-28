import type { PaymentPageState } from "@/lib/payments/payment-page-data"

const paymentPageRedirects = {
  confirmed: (reservationId: string) => `/reservations/${reservationId}/complete`,
  expired_pending: null,
  not_found: null,
  pending_valid: null,
  read_failure: null,
  ready: null,
  terminal: null,
  unavailable: null,
} satisfies Record<PaymentPageState, ((reservationId: string) => string) | null>

export function getPaymentPageRedirectPath(
  state: PaymentPageState,
  reservationId: string,
): string | null {
  return paymentPageRedirects[state]?.(reservationId) ?? null
}
