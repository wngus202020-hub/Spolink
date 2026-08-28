import assert from "node:assert/strict"

import { assertFocusVisible, readFocusState } from "./focus.mjs"
import { filePayload } from "./image-fixtures.mjs"
import { captureAuthoringState, hideNextDevelopmentPortal } from "./visual-capture.mjs"

export async function runEditingScenario(harness, draftResult) {
  const { fixture, page, viewportReceipts } = harness
  const lessonId = fixture.getLessonId()
  const title = page.getByLabel("레슨 제목")
  await title.fill("저장하지 않은 제목 유지")
  const reorderResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/lessons/${lessonId}/images/order`),
  )
  await page.getByRole("button", { name: "대표 이미지로 설정" }).last().click()
  assert.equal((await reorderResponse).status(), 200)
  assert.equal(await title.inputValue(), "저장하지 않은 제목 유지")
  await captureAuthoringState({
    evidenceDir: fixture.evidenceDir,
    page,
    receipts: viewportReceipts,
    state: "reordered-cover",
  })

  await forceStaleReorder(page, lessonId)
  assert.equal(await title.inputValue(), "저장하지 않은 제목 유지")
  const deleteCancelFocusState = await cancelDelete(harness)
  const deleteConfirmFocusState = await confirmDelete(harness, title)

  await page
    .getByLabel("레슨 이미지 추가")
    .setInputFiles(filePayload("추가.webp", draftResult.imageBuffers[0]))
  assert.equal(await page.getByRole("button", { name: "검토 요청" }).isDisabled(), true)
  await captureAuthoringState({
    evidenceDir: fixture.evidenceDir,
    page,
    receipts: viewportReceipts,
    state: "review-blocked",
  })
  await page.getByRole("button", { name: "이미지 저장" }).click()
  await page.getByText("이미지를 저장했습니다.", { exact: true }).waitFor()
  assert.equal(await title.inputValue(), "저장하지 않은 제목 유지")
  assert.equal(await page.getByRole("button", { name: "검토 요청" }).isEnabled(), true)
  const [lessonAfterEditImageActions] =
    await fixture.sql`select updated_at from public.lessons where id = ${lessonId}`
  assert.equal(
    lessonAfterEditImageActions.updated_at.toISOString(),
    draftResult.lessonBeforeEditImageActions.updated_at.toISOString(),
  )
  await hideNextDevelopmentPortal(page)
  await page.screenshot({ fullPage: true, path: `${fixture.evidenceDir}/task-7-edit-desktop.png` })
  await captureAuthoringState({
    evidenceDir: fixture.evidenceDir,
    page,
    receipts: viewportReceipts,
    state: "added-five",
  })
  return { deleteCancelFocusState, deleteConfirmFocusState }
}

async function forceStaleReorder(page, lessonId) {
  await page.route(
    `**/api/lessons/${lessonId}/images/order`,
    (route) =>
      route.fulfill({
        body: JSON.stringify({ error: { code: "CONFLICT", details: [], message: "stale" } }),
        contentType: "application/json",
        status: 409,
      }),
    { times: 1 },
  )
  await page.getByRole("button", { name: "이미지 순서 뒤로 미루기" }).first().click()
  await page
    .getByText("이미지 상태가 변경되었습니다. 이 페이지를 새로 열어 다시 시도해 주세요.", {
      exact: true,
    })
    .waitFor()
}

async function cancelDelete(harness) {
  const { fixture, page, viewportReceipts } = harness
  const originatingButton = page.getByRole("button", { name: "이미지 삭제" }).first()
  await originatingButton.focus()
  await originatingButton.press("Enter")
  const dialog = page.getByRole("dialog")
  await dialog.waitFor()
  await captureAuthoringState({
    evidenceDir: fixture.evidenceDir,
    page,
    receipts: viewportReceipts,
    state: "delete-dialog",
  })
  await dialog.getByRole("button", { name: "취소" }).press("Enter")
  await dialog.waitFor({ state: "hidden" })
  const focusState = await readFocusState(originatingButton)
  assertFocusVisible(focusState, "originating delete button after cancel")
  await captureAuthoringState({
    evidenceDir: fixture.evidenceDir,
    page,
    receipts: viewportReceipts,
    state: "delete-cancel",
  })
  await hideNextDevelopmentPortal(page)
  await page.screenshot({
    fullPage: true,
    path: `${fixture.evidenceDir}/task-7-focus-delete-cancel-desktop.png`,
  })
  return focusState
}

async function confirmDelete(harness, title) {
  const { fixture, page, viewportReceipts } = harness
  const response = page.waitForResponse(
    (item) => item.request().method() === "DELETE" && item.url().includes("/images/"),
  )
  await page.getByRole("button", { name: "이미지 삭제" }).first().focus()
  await page.getByRole("button", { name: "이미지 삭제" }).first().press("Enter")
  await page.getByRole("dialog").getByRole("button", { name: "삭제" }).press("Enter")
  assert.equal((await response).status(), 200)
  assert.equal(await title.inputValue(), "저장하지 않은 제목 유지")
  await page.waitForFunction(() => document.activeElement?.hasAttribute("data-lesson-image-id"))
  const postDeleteTarget = page.locator("[data-lesson-image-id]").first()
  await postDeleteTarget.waitFor()
  const focusState = await readFocusState(postDeleteTarget)
  assertFocusVisible(focusState, "neighbor after confirmed delete")
  await captureAuthoringState({
    evidenceDir: fixture.evidenceDir,
    page,
    receipts: viewportReceipts,
    state: "delete-confirmed",
  })
  return focusState
}
