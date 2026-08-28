import { readReservationDetailData } from "./reservation-read-data"
import type { ReservationDetailRead, ReservationDetailView } from "./reservation-read-types"

export type ReservationCompletionState =
  | "complete"
  | "mismatch"
  | "not_found"
  | "pending"
  | "read_failure"
  | "terminal"

export type ReservationCompletionPageData = Readonly<{
  state: ReservationCompletionState
  viewModel: ReservationDetailView | null
}>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export function classifyReservationCompletionState(
  viewModel: ReservationDetailView,
  now: Date,
): Exclude<ReservationCompletionState, "not_found" | "read_failure"> {
  switch (viewModel.reservationStatus) {
    case "completed":
    case "cancelled_by_user":
    case "cancelled_by_coach":
    case "cancelled_by_admin":
    case "no_show_user":
    case "no_show_coach":
    case "disputed":
      return "terminal"
    case "confirmed":
      return viewModel.paymentStatus === "paid" ? "complete" : "mismatch"
    case "pending_payment":
      if (!Number.isFinite(now.getTime())) return "mismatch"
      if (viewModel.paymentStatus !== null && viewModel.paymentStatus !== "ready") {
        return "mismatch"
      }
      return viewModel.canContinuePayment ? "pending" : "mismatch"
  }
}

export async function readReservationCompletionPageData(
  reservationId: string,
  learnerId: string,
  read: ReservationDetailRead,
  now: Date = new Date(),
): Promise<ReservationCompletionPageData> {
  if (!uuidPattern.test(reservationId)) {
    return { state: "not_found", viewModel: null }
  }

  const detail = await readReservationDetailData(reservationId, learnerId, read, now)
  if (detail.state === "not_found") {
    return { state: "not_found", viewModel: null }
  }
  if (detail.state === "read_failure" || detail.viewModel === null) {
    return { state: "read_failure", viewModel: null }
  }

  return {
    state: classifyReservationCompletionState(detail.viewModel, now),
    viewModel: detail.viewModel,
  }
}
