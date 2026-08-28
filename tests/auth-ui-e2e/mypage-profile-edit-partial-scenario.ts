import { expect, type Page, type TestInfo } from "@playwright/test"
import type { ProfileSeed } from "./mypage-profile-edit-fixtures"
import {
  assertEditedValuesRetained,
  type ObservedPatch,
  regionSearchbox,
  setCheckbox,
  waitForProfileRefreshResponse,
} from "./mypage-profile-edit-page"
import {
  appendProfileEditObservation,
  captureProfileEditScreenshot,
} from "./mypage-profile-edit-visual"

export async function savePartialProfileEditChange({
  observedPatches,
  page,
  partial,
  testInfo,
}: Readonly<{
  observedPatches: readonly ObservedPatch[]
  page: Page
  partial: ProfileSeed
  testInfo: TestInfo
}>): Promise<void> {
  const startCount = observedPatches.length

  await page.getByLabel("활동 이름 (필수)").fill(partial.displayName)
  await setCheckbox(page.getByLabel("내 주변 레슨 안내를 위한 위치 이용에 동의해요."), true)

  const profileRefreshFinished = waitForProfileRefreshResponse(page)
  const save = page.getByRole("button", { name: "변경사항 저장" })
  await expect(save).toBeEnabled()
  await save.click()
  await expect(page.getByText("프로필 정보를 저장했어요.")).toBeVisible()
  await profileRefreshFinished

  const partialPatches = observedPatches.slice(startCount)
  expect(partialPatches).toEqual([{ displayName: partial.displayName, locationAgreed: true }])
  expect(partialPatches).toHaveLength(1)

  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle")
  await assertEditedValuesRetained(page, partial)
  await expect(page.getByRole("button", { name: "변경사항 저장" })).toBeDisabled()
  await appendProfileEditObservation({
    keys: Object.keys(partialPatches[0] ?? {}).sort(),
    project: testInfo.project.name,
    requestCount: partialPatches.length,
    scenario: "partial-changed-only-save",
    type: "partial-patch",
  })
}

export async function assertInvalidDisplayNameFocusWithoutPatch({
  observedPatches,
  page,
}: Readonly<{
  observedPatches: readonly ObservedPatch[]
  page: Page
}>): Promise<void> {
  const startCount = observedPatches.length
  const displayName = page.getByLabel("활동 이름 (필수)")
  const save = page.getByRole("button", { name: "변경사항 저장" })

  await displayName.fill(" ")
  await expect(save).toBeDisabled()
  await displayName.press("Enter")
  await expect(displayName).toBeFocused()
  await expect(page.getByText("활동 이름은 2자 이상 입력해요.")).toBeVisible()
  expect(observedPatches).toHaveLength(startCount)
}

export async function assertInvalidRegionFocusWithoutPatch({
  observedPatches,
  page,
  testInfo,
}: Readonly<{
  observedPatches: readonly ObservedPatch[]
  page: Page
  testInfo: TestInfo
}>): Promise<void> {
  const startCount = observedPatches.length
  const search = regionSearchbox(page)

  await page
    .getByRole("region", { name: "수정할 정보" })
    .locator("form")
    .evaluate((form) => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

  await expect(search).toBeFocused()
  await expect(search).toHaveAttribute("aria-invalid", "true")
  await expect(search).toHaveAttribute("aria-describedby", /profile-edit-region-error/u)
  await expect(page.locator("#profile-edit-region-error")).toHaveText(
    "목록에서 기본 활동 지역을 선택해요.",
  )
  await expect(page.getByText("활동 이름은 2자 이상 입력해요.")).toHaveCount(0)
  await expect(page.getByText("실명은 2자 이상 입력해요.")).toHaveCount(0)
  await expect(page.getByText("올바른 휴대폰 번호를 입력해요.")).toHaveCount(0)
  expect(observedPatches).toHaveLength(startCount)

  if (testInfo.project.name === "mobile-chromium") {
    await captureProfileEditScreenshot({
      focusTarget: search,
      page,
      state: "validation",
      testInfo,
      validationFeedback: true,
    })
  }
}
