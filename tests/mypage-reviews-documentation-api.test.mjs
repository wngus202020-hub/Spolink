import assert from "node:assert/strict"
import test from "node:test"

import {
  bullets,
  fencedBlocks,
  inlineCode,
  readDocument,
  section,
} from "./mypage-reviews-documentation-helpers.mjs"

test("Given review read documentation, when API sections are parsed, then owner and public surfaces stay distinct", async () => {
  const api = await readDocument("SPOLINK_API_명세서.md")
  assertApiSemantics(api)
})

test("API mutation probe rejects a public-hidden or owner-HTTP contract without pinning prose", async () => {
  const api = await readDocument("SPOLINK_API_명세서.md")
  assert.doesNotThrow(() =>
    assertApiSemantics(api.replace("최신순으로 조회한다", "시간 역순으로 조회한다")),
  )
  assert.throws(() =>
    assertApiSemantics(api.replace("reviews.status = visible", "reviews.status = hidden")),
  )
  assert.throws(() =>
    assertApiSemantics(
      api.replace(
        "### 내 리뷰 관리 읽기\n",
        "### 내 리뷰 관리 읽기\n\n```http\nGET /api/reviews/me\n```\n",
      ),
    ),
  )
})

function assertApiSemantics(markdown) {
  const reviewApi = section(markdown, "## 리뷰 API")
  const publicRead = section(reviewApi, "### 레슨 리뷰 목록")
  const ownerRead = section(reviewApi, "### 내 리뷰 관리 읽기")
  assert.deepEqual(fencedBlocks(publicRead, "http"), [
    "GET /api/lessons/{lessonId}/reviews\n권한: Public\n테이블: reviews",
  ])
  assert.equal(bullets(publicRead)[0].code.includes("reviews.status = visible"), true)
  assert.deepEqual(fencedBlocks(ownerRead, "http"), [])
  const ownerTokens = new Set(inlineCode(ownerRead))
  for (const token of [
    "GET",
    "/mypage/reviews",
    "auth.profile.id",
    "reviewer_id",
    "visible",
    "hidden",
    "deleted",
    "GET /api/lessons/{lessonId}/reviews",
  ]) {
    assert.equal(ownerTokens.has(token), true, `missing owner API token: ${token}`)
  }
}
