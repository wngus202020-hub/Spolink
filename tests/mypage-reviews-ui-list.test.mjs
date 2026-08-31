import assert from "node:assert/strict"
import test from "node:test"
import { createElement } from "react"
import {
  assertNoHorizontalOverflow,
  compileReviewUtilityCss,
  readElementRect,
} from "./mypage-reviews-ui-browser.mjs"
import { readyViewModel } from "./mypage-reviews-ui-fixtures.mjs"
import { loadReviewComponents } from "./mypage-reviews-ui-runtime.mjs"
import { inspectRenderedHtml } from "./react-html-runtime.mjs"

test("Given ready review data, when the reusable list renders at 390px, then rows expose safe history semantics without overflow", async () => {
  const { ReviewHistoryList } = await loadReviewComponents()
  await inspectRenderedHtml(
    createElement(ReviewHistoryList, { viewModel: readyViewModel }),
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      assert.equal(await page.getByRole("heading", { level: 2, name: "리뷰 내역" }).count(), 1)
      assert.equal(await page.getByText("총 21건").count(), 1)
      assert.equal(await page.getByLabel("5점 만점에 5점").count(), 1)
      assert.equal(await page.getByLabel("5점 만점에 1점").count(), 1)
      assert.equal(await page.locator("time").count(), 2)
      assert.equal(await page.getByText("숨김 사유").count(), 1)
      assert.equal(await page.locator("a[href='/lessons/active-lesson']").count(), 1)
      assert.equal(await page.locator("a[href*='unavailable'], a[href*='undefined']").count(), 0)
      await assertNoHorizontalOverflow(page)
    },
  )
})

test("Given review history targets, when production utilities render each pagination state, then every required target is at least 44px", async () => {
  const { ReviewHistoryList } = await loadReviewComponents()
  const targetViewModel = {
    ...readyViewModel,
    items: [{ ...readyViewModel.items[0], lessonTitle: "활성 레슨" }, readyViewModel.items[1]],
  }
  const geometryFailures = []
  for (const state of [
    { expectedLink: "다음", page: 1 },
    { expectedLink: "이전", page: 2 },
  ]) {
    await inspectRenderedHtml(
      createElement(ReviewHistoryList, { viewModel: { ...targetViewModel, page: state.page } }),
      async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 })
        await page.addStyleTag({ content: await compileReviewUtilityCss(page) })
        const activeLesson = page.getByRole("link", { name: targetViewModel.items[0].lessonTitle })
        const activeLessonRect = await readElementRect(activeLesson)
        if (activeLessonRect.height < 44 || activeLessonRect.width < 44) {
          geometryFailures.push({ label: "active lesson", ...activeLessonRect })
        }
        assert.equal(
          await page
            .getByRole("heading", { level: 3, name: targetViewModel.items[1].lessonTitle })
            .count(),
          1,
        )
        const pagination = await page
          .locator("nav[aria-label='리뷰 목록 페이지'] > *")
          .evaluateAll((nodes) =>
            nodes.map((node) => {
              const rect = node.getBoundingClientRect()
              return {
                height: rect.height,
                label: node.textContent?.trim() ?? "",
                width: rect.width,
              }
            }),
          )
        assert.deepEqual(
          pagination.map((target) => target.label),
          ["이전", "다음"],
        )
        for (const target of pagination) {
          if (target.height < 44 || target.width < 44) geometryFailures.push(target)
        }
        assert.equal(await page.getByRole("link", { name: state.expectedLink }).count(), 1)
        await assertNoHorizontalOverflow(page)
      },
    )
  }
  assert.deepEqual(geometryFailures, [])
})
