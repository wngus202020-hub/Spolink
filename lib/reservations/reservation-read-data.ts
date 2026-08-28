import { RESERVATIONS_PER_PAGE } from "./reservation-read-presentation"
import {
  readReservationDetailSnapshot,
  readReservationListSnapshot,
} from "./reservation-read-query"
import type {
  ReservationDetailData,
  ReservationDetailRead,
  ReservationDetailReadSnapshot,
  ReservationFilter,
  ReservationListData,
  ReservationListRead,
  ReservationListReadSnapshot,
} from "./reservation-read-types"
import { buildReservationDetailView, buildReservationSummaryView } from "./reservation-read-view"

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
    buildReservationSummaryView(reservation, snapshot, now),
  )
  return {
    state: items.length === 0 ? "empty" : "ready",
    viewModel: {
      filter,
      items,
      page,
      totalCount: snapshot.totalCount,
      totalPages: Math.max(1, Math.ceil(snapshot.totalCount / RESERVATIONS_PER_PAGE)),
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

  return { state: "ready", viewModel: buildReservationDetailView(snapshot, now) }
}
