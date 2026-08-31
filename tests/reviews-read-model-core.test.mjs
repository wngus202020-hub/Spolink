import assert from "node:assert/strict"
import test from "node:test"

import { importReviewModel, importReviewQuery } from "./reviews-read-model-compiler.mjs"
import { found, review } from "./reviews-read-model-fixtures.mjs"

test("review history normalizes every malformed page class", async () => {
  const { normalizeReviewHistoryPage, REVIEWS_PER_PAGE } = await importReviewModel("normalization")
  const malformed = [undefined, ["2"], "0", "-1", "1.5", "9007199254740992", "abc"]
  assert.deepEqual(malformed.map(normalizeReviewHistoryPage), [1, 1, 1, 1, 1, 1, 1])
  assert.equal(normalizeReviewHistoryPage("2"), 2)
  assert.equal(REVIEWS_PER_PAGE, 20)
})

test("review snapshot scopes owner rows before unique enrichment", async () => {
  const { readReviewHistorySnapshot } = await importReviewModel("owner-first")
  const calls = []
  const actual = await readReviewHistorySnapshot("learner-owned", 2, {
    readOwnedReviews: async (learnerId, first, last) => {
      calls.push(["owner", learnerId, first, last])
      return {
        kind: "found",
        reviews: [review(), review({ id: "review-hidden", status: "hidden" })],
        totalCount: 21,
      }
    },
    enrichOwnedReviews: async (lessonIds, coachIds) => {
      calls.push(["enrich", lessonIds, coachIds])
      return { coaches: [], kind: "found", lessons: [] }
    },
  })
  assert.equal(actual.kind, "found")
  assert.deepEqual(calls, [
    ["owner", "learner-owned", 20, 39],
    ["enrich", ["lesson-owned"], ["coach-owned"]],
  ])
})

test("review snapshot never enriches empty failed or thrown owner reads", async () => {
  const { readReviewHistorySnapshot } = await importReviewModel("owner-short-circuit")
  const reads = [
    async () => ({ kind: "found", reviews: [], totalCount: 0 }),
    async () => ({ kind: "read_failure" }),
    async () => {
      throw new Error("owner unavailable")
    },
  ]
  let enrichCalls = 0
  const actual = []
  for (const readOwnedReviews of reads) {
    const result = await readReviewHistorySnapshot("learner-owned", 1, {
      readOwnedReviews,
      enrichOwnedReviews: async () => {
        enrichCalls += 1
        return { coaches: [], kind: "found", lessons: [] }
      },
    })
    actual.push(result.kind)
  }
  assert.equal(enrichCalls, 0)
  assert.deepEqual(actual, ["found", "read_failure", "read_failure"])
})

test("review history distinguishes empty out of range and unavailable reads", async () => {
  const { readReviewHistoryData } = await importReviewModel("data-states")
  const actual = await Promise.all([
    readReviewHistoryData("owner", 1, async () => found({ reviews: [], totalCount: 0 })),
    readReviewHistoryData("owner", 3, async () => found({ reviews: [], totalCount: 21 })),
    readReviewHistoryData("owner", 1, async () => ({ kind: "read_failure" })),
    readReviewHistoryData("owner", 1, async () => {
      throw new Error("read unavailable")
    }),
  ])
  assert.deepEqual(
    actual.map((entry) => entry.state),
    ["empty", "out_of_range", "read_failure", "read_failure"],
  )
  assert.equal(actual[2].viewModel, null)
  assert.equal(actual[3].viewModel, null)
})

test("unsatisfiable PostgREST range recounts ownership while real errors stay failed", async () => {
  const { mapOwnedReviewQueryResult } = await importReviewQuery("range-recount")
  let recountCalls = 0
  const recount = async () => {
    recountCalls += 1
    return { count: 21, error: null }
  }
  const recovered = await mapOwnedReviewQueryResult(
    { count: null, data: null, error: { code: "PGRST103" } },
    recount,
  )
  const failed = await mapOwnedReviewQueryResult(
    { count: null, data: null, error: { code: "42501" } },
    recount,
  )
  assert.deepEqual(recovered, { kind: "found", reviews: [], totalCount: 21 })
  assert.deepEqual(failed, { kind: "read_failure" })
  assert.equal(recountCalls, 1)
})

test("review snapshot converts enrichment failure and throw", async () => {
  const { readReviewHistorySnapshot } = await importReviewModel("enrichment-failure")
  const readOwnedReviews = async () => ({ kind: "found", reviews: [review()], totalCount: 1 })
  const actual = await Promise.all([
    readReviewHistorySnapshot("owner", 1, {
      readOwnedReviews,
      enrichOwnedReviews: async () => ({ kind: "read_failure" }),
    }),
    readReviewHistorySnapshot("owner", 1, {
      readOwnedReviews,
      enrichOwnedReviews: async () => {
        throw new Error("service unavailable")
      },
    }),
  ])
  assert.deepEqual(actual, [{ kind: "read_failure" }, { kind: "read_failure" }])
})
