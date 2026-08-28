import { readPaymentPageSnapshot } from "./payment-page-read"
import { classifyPaymentPageState } from "./payment-page-state"
import type {
  PaymentPageData,
  PaymentPageRead,
  PaymentPageReadSnapshot,
} from "./payment-page-types"
import { buildPaymentPageViewModel } from "./payment-page-view-model"

export type {
  PaymentPageData,
  PaymentPageRead,
  PaymentPageReadSnapshot,
  PaymentPageState,
  PaymentPageViewModel,
  PaymentReadyView,
} from "./payment-page-types"
export { classifyPaymentPageState, readPaymentPageSnapshot }

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
    viewModel: snapshot.kind === "found" ? buildPaymentPageViewModel(snapshot, state) : null,
  }
}
