import assert from "node:assert/strict"
import test from "node:test"

import { importReviewModel } from "./reviews-read-model-compiler.mjs"
import { coach, found, lesson, review } from "./reviews-read-model-fixtures.mjs"

test("review history keeps exact twenty one row pagination stable on timestamp ties", async () => {
  const { readReviewHistoryData, REVIEWS_PER_PAGE } = await importReviewModel("stable-pagination")
  const rows = Array.from({ length: 21 }, (_, index) =>
    review({ id: `review-${String(index + 1).padStart(2, "0")}` }),
  ).reverse()
  const read = async (_owner, page) =>
    found({
      reviews: rows.slice((page - 1) * REVIEWS_PER_PAGE, page * REVIEWS_PER_PAGE),
      totalCount: 21,
    })
  const [first, second] = await Promise.all([
    readReviewHistoryData("owner", 1, read),
    readReviewHistoryData("owner", 2, read),
  ])
  assert.equal(first.viewModel.items.length, 20)
  assert.equal(second.viewModel.items.length, 1)
  assert.deepEqual(
    [first.viewModel.items[0].key, first.viewModel.items[19].key, second.viewModel.items[0].key],
    ["review-21", "review-02", "review-01"],
  )
  assert.equal(first.viewModel.totalPages, 2)
})

test("review history presents safe Korean visible and hidden rows", async () => {
  const { readReviewHistoryData } = await importReviewModel("safe-presentation")
  const snapshot = found({
    coaches: [coach(), coach({ id: "coach-unapproved", status: "submitted" })],
    lessons: [
      lesson(),
      lesson({
        coachProfileId: "coach-unapproved",
        id: "lesson-paused",
        status: "paused",
        title: "운영 중단 레슨",
      }),
    ],
    reviews: [
      review(),
      review({
        coachProfileId: "coach-unapproved",
        content: null,
        hiddenReason: "운영 정책 위반",
        id: "review-hidden",
        lessonId: "lesson-paused",
        rating: 3,
        status: "hidden",
      }),
    ],
    totalCount: 2,
  })
  const actual = await readReviewHistoryData("owner", 1, async () => snapshot)
  assert.deepEqual(
    actual.viewModel.items.map((item) => ({
      content: item.content,
      hiddenReason: item.hiddenReason,
      href: item.lessonHref,
      label: item.status.label,
      tone: item.status.tone,
    })),
    [
      {
        content: "친절하고 알찬 수업이었습니다.",
        hiddenReason: null,
        href: "/lessons/lesson-owned",
        label: "공개 중",
        tone: "success",
      },
      {
        content: "작성한 내용이 없습니다.",
        hiddenReason: "운영 정책 위반",
        href: null,
        label: "숨김",
        tone: "warning",
      },
    ],
  )
  assert.doesNotMatch(
    JSON.stringify(actual),
    /reviewer|learner|owner|profileId|profile_id|service.role|provider|raw|error|deleted/iu,
  )
})

test("review href requires active lesson matching an approved coach", async () => {
  const { readReviewHistoryData } = await importReviewModel("href-eligibility")
  const snapshot = found({
    coaches: [
      coach(),
      coach({ id: "coach-other" }),
      coach({ id: "coach-unapproved", status: "submitted" }),
    ],
    lessons: [
      lesson({ id: "lesson-closed", status: "closed" }),
      lesson({ id: "lesson-paused", status: "paused" }),
      lesson({ coachProfileId: "coach-unapproved", id: "lesson-unapproved" }),
      lesson({ coachProfileId: "coach-other", id: "lesson-mismatch" }),
    ],
    reviews: [
      review({ id: "review-closed", lessonId: "lesson-closed" }),
      review({ id: "review-paused", lessonId: "lesson-paused" }),
      review({
        coachProfileId: "coach-unapproved",
        id: "review-unapproved",
        lessonId: "lesson-unapproved",
      }),
      review({ id: "review-mismatch", lessonId: "lesson-mismatch" }),
      review({ id: "review-missing", lessonId: "lesson-missing" }),
    ],
    totalCount: 5,
  })
  const actual = await readReviewHistoryData("owner", 1, async () => snapshot)
  assert.deepEqual(
    actual.viewModel.items.map((item) => item.lessonHref),
    [null, null, null, null, null],
  )
  assert.equal(
    actual.viewModel.items.find((item) => item.key === "review-missing").lessonTitle,
    "더 이상 공개되지 않는 레슨",
  )
})
