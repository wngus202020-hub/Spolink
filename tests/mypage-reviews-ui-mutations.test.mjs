import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import {
  compileReviewUtilityCss,
  readElementRect,
  removeMinimumHeightFromLink,
} from "./mypage-reviews-ui-browser.mjs"
import { configureRuntime, loadReviewsPage } from "./mypage-reviews-ui-runtime.mjs"
import { assertReviewPageSemanticContract } from "./mypage-reviews-ui-semantics.mjs"
import { inspectRenderedHtml } from "./react-html-runtime.mjs"

test("UI semantic contract tolerates copy changes and rejects owner or state mutations", async () => {
  const source = await readFile(new URL("../app/mypage/reviews/page.tsx", import.meta.url), "utf8")
  assert.doesNotThrow(() => assertReviewPageSemanticContract(source))
  assert.doesNotThrow(() =>
    assertReviewPageSemanticContract(
      source.replace("작성한 리뷰와 공개 상태를 확인해요.", "새 안내 문구"),
    ),
  )
  assert.throws(() =>
    assertReviewPageSemanticContract(source.replace("auth.profile.id, page", "query.page, page")),
  )
  assert.throws(() =>
    assertReviewPageSemanticContract(
      source.replace('reviewData.state === "empty"', 'reviewData.state === "ready"'),
    ),
  )
})

test("rendered 44px contract rejects a target-height mutation without changing product source", async () => {
  const Page = (await loadReviewsPage()).default
  configureRuntime({
    data: { state: "empty", viewModel: { items: [], page: 1, totalCount: 0, totalPages: 1 } },
  })
  const element = await Page({ searchParams: Promise.resolve({}) })
  const mutated = removeMinimumHeightFromLink(element, "/mypage")
  const heights = []
  for (const candidate of [element, mutated]) {
    await inspectRenderedHtml(candidate, async ({ page }) => {
      await page.addStyleTag({ content: await compileReviewUtilityCss(page) })
      heights.push((await readElementRect(page.getByRole("link", { name: "마이페이지" }))).height)
    })
  }
  assert.ok(heights[0] >= 44)
  assert.ok(heights[1] < 44)
})
