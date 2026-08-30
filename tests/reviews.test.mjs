import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import "./profile-api/fixtures.mjs"

const reviewId = "71000000-0000-4000-8000-000000000001"
const reservationId = "72000000-0000-4000-8000-000000000001"

test("review contracts accept only bounded learner input and reject forged authority", async () => {
  const { createReviewSchema, hideReviewSchema } = await import("../lib/reviews/contract.ts")
  assert.equal(
    createReviewSchema.safeParse({ reservationId, rating: 5, content: "좋았어요" }).success,
    true,
  )
  assert.equal(
    createReviewSchema.safeParse({ reservationId, rating: 6, content: "좋았어요" }).success,
    false,
  )
  assert.equal(
    createReviewSchema.safeParse({ reservationId, rating: 5, content: "" }).success,
    false,
  )
  assert.equal(
    createReviewSchema.safeParse({
      reservationId,
      rating: 5,
      content: "좋았어요",
      reviewerId: reviewId,
    }).success,
    false,
  )
  assert.equal(hideReviewSchema.safeParse({ reason: "정책 위반" }).success, true)
  assert.equal(
    hideReviewSchema.safeParse({ reason: "정책 위반", reviewedBy: reviewId }).success,
    false,
  )
})

test("review form exposes the history link only after a successful review write without navigation", async () => {
  const source = await readFile("components/reviews/review-form.tsx", "utf8")

  assert.match(source, /response\.ok[\s\S]*?setContent\(""\)/u)
  assert.match(
    source,
    /response\.ok[\s\S]*?<Link[\s\S]*?href="\/mypage\/reviews"[\s\S]*?>[\s\S]*?내 리뷰 보기/u,
  )
  assert.doesNotMatch(
    source,
    /(?:router\.(?:push|replace)|window\.location\.(?:assign|replace|href))/u,
  )
})

test("review workflow maps duplicate, stale, foreign, and unauthorized persistence failures", async () => {
  const { runCreateReview, runHideReview } = await import("../lib/reviews/workflow.ts")
  const dependencies = {
    createReview: async () => ({ errorCode: "23505", row: null }),
    hideReview: async () => ({ errorCode: "42501", row: null }),
  }
  assert.equal(
    (await runCreateReview({ reservationId, rating: 5, content: "좋았어요" }, dependencies)).error
      .code,
    "CONFLICT",
  )
  assert.equal(
    (await runHideReview({ reason: "정책 위반", reviewId }, dependencies)).error.code,
    "FORBIDDEN",
  )
})

test("review route rejects cross-origin, invalid content type, malformed, and replayed commands", async () => {
  const { createReviewRouteHandler } = await import("../lib/reviews/route-handler.ts")
  let writes = 0
  const handler = createReviewRouteHandler({
    configured: () => true,
    createClient: async () => ({
      client: {
        createReview: async () => {
          writes += 1
          return { errorCode: "23505", row: null }
        },
        hideReview: async () => ({ errorCode: null, row: null }),
      },
      userId: "73000000-0000-4000-8000-000000000001",
    }),
  })
  const request = (body, origin = "https://spolink.test", contentType = "application/json") =>
    new Request("https://spolink.test/api/reviews", {
      body: JSON.stringify(body),
      headers: { "Content-Type": contentType, Origin: origin },
      method: "POST",
    })
  assert.equal(
    (await handler(request({ reservationId, rating: 5, content: "좋았어요" }, "https://evil.test")))
      .status,
    403,
  )
  assert.equal(
    (
      await handler(
        request(
          { reservationId, rating: 5, content: "좋았어요" },
          "https://spolink.test",
          "text/plain",
        ),
      )
    ).status,
    415,
  )
  assert.equal(
    (await handler(request({ reservationId, rating: 0, content: "좋았어요" }))).status,
    422,
  )
  assert.equal(
    (await handler(request({ reservationId, rating: 5, content: "좋았어요" }))).status,
    409,
  )
  assert.equal(writes, 1)
})

test("review migration owns eligibility, public visibility, audit, locking, and admin RPC grants", async () => {
  const sql = await readFile("supabase/migrations/20260814130000_add_review_lifecycle.sql", "utf8")
  for (const pattern of [
    /create or replace function public\.create_review/iu,
    /status <> 'completed'/iu,
    /status in \('refunded', 'partially_refunded'\)/iu,
    /for update/iu,
    /create or replace function public\.hide_review/iu,
    /audit_logs/iu,
    /using \(status = 'visible'\)/iu,
    /revoke insert, update, delete on table public\.reviews/iu,
  ])
    assert.match(sql, pattern)
  assert.doesNotMatch(sql, /delete from public\.reviews/iu)
})
