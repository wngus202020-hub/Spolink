import { buildReviewHistoryItems, REVIEWS_PER_PAGE } from "./read-presentation"
import { readReviewHistorySnapshot } from "./read-query"
import type { ReviewHistoryData, ReviewHistoryRead, ReviewHistoryReadSnapshot } from "./read-types"

export async function readReviewHistoryData(
  learnerId: string,
  page: number,
  read: ReviewHistoryRead = readReviewHistorySnapshot,
): Promise<ReviewHistoryData> {
  let snapshot: ReviewHistoryReadSnapshot
  try {
    snapshot = await read(learnerId, page)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { state: "read_failure", viewModel: null }
  }
  if (snapshot.kind === "read_failure") {
    return { state: "read_failure", viewModel: null }
  }

  const items = buildReviewHistoryItems(snapshot.reviews, snapshot)
  const viewModel = {
    items,
    page,
    totalCount: snapshot.totalCount,
    totalPages: Math.max(1, Math.ceil(snapshot.totalCount / REVIEWS_PER_PAGE)),
  }
  if (items.length > 0) return { state: "ready", viewModel }
  if (page === 1 && snapshot.totalCount === 0) return { state: "empty", viewModel }
  return { state: "out_of_range", viewModel }
}
