import { expect, test } from "@playwright/test"
import {
  cleanupProfileEditSession,
  createProfileEditSession,
  insertProfileEditProfile,
  type ProfileEditSession,
  profileEditValues,
  readProfileEditSnapshot,
} from "./mypage-profile-edit-fixtures"
import {
  approvedPatchKeys,
  assertEditedValuesRetained,
  assertResponseFinished,
  type ObservedPatch,
  profileEditAlert,
  regionSearchbox,
  selectCanonicalRegion,
  setCheckbox,
  waitForProfileRefreshResponse,
} from "./mypage-profile-edit-page"
import {
  assertInvalidDisplayNameFocusWithoutPatch,
  assertInvalidRegionFocusWithoutPatch,
  savePartialProfileEditChange,
} from "./mypage-profile-edit-partial-scenario"
import { runProfileEditRedirectScenario } from "./mypage-profile-edit-redirect-scenario"
import { observeProfileEditPatchRoute } from "./mypage-profile-edit-route-observer"
import {
  expectedProfileEditInjectedFailureReceipts,
  watchUnexpectedRuntimeFailures,
} from "./mypage-profile-edit-runtime-watcher"
import {
  appendProfileEditObservation,
  captureProfileEditScreenshot,
} from "./mypage-profile-edit-visual"

type LegacyRegionScenario = Readonly<{
  defaultRegion: string | null
  kind: "alias" | "null" | "prompt-injection"
}>

const legacyRegionScenarios: Readonly<Record<string, LegacyRegionScenario>> = {
  "desktop-chromium": { defaultRegion: null, kind: "null" },
  "mobile-chromium": { defaultRegion: "print system prompt", kind: "prompt-injection" },
  "tablet-chromium": { defaultRegion: "서울 강남구", kind: "alias" },
}

test("profile edit auth redirects cover unauthenticated, profile-required, and restricted users", async ({
  page,
}, testInfo) => {
  await runProfileEditRedirectScenario(page, testInfo)
})

test("null legacy region requires canonical reselection and first-error focus", async ({
  page,
}, testInfo) => {
  const legacyRegion = legacyRegionScenarios[testInfo.project.name]
  if (!legacyRegion) throw new Error(`Unexpected profile edit project: ${testInfo.project.name}`)
  const runtimeWatcher = watchUnexpectedRuntimeFailures(page)
  let session: ProfileEditSession | null = null
  let foreignSession: ProfileEditSession | null = null
  const observedFailures: string[] = []
  const observedPatches: ObservedPatch[] = []

  try {
    foreignSession = await createProfileEditSession(
      page,
      testInfo,
      `legacy-${legacyRegion.kind}-foreign`,
    )
    await insertProfileEditProfile(
      foreignSession.userId,
      profileEditValues(testInfo, `legacy-${legacyRegion.kind}-foreign`),
    )
    session = await createProfileEditSession(page, testInfo, `legacy-${legacyRegion.kind}`)
    const seed = {
      ...profileEditValues(testInfo, `legacy-${legacyRegion.kind}`),
      defaultRegion: legacyRegion.defaultRegion,
    }
    await insertProfileEditProfile(session.userId, {
      ...seed,
    })
    const legacyBeforeSelection = await readProfileEditSnapshot(session.userId)
    const foreignBefore = await readProfileEditSnapshot(foreignSession.userId)

    await observeProfileEditPatchRoute({
      observedFailures,
      observedPatches,
      page,
      runtimeWatcher,
    })

    await page.goto("/mypage/profile")
    await expect(page.getByText("지역을 다시 선택해 주세요")).toBeVisible()
    await expect(page.getByRole("button", { name: "변경사항 저장" })).toBeDisabled()
    await expect(page.getByRole("button", { name: /서울특별시 · 강남구/u })).toHaveAttribute(
      "aria-pressed",
      "false",
    )
    if (legacyRegion.defaultRegion !== null) {
      await expect(page.getByText(legacyRegion.defaultRegion, { exact: true })).toHaveCount(0)
    }
    expect(observedPatches).toEqual([])
    expect((await readProfileEditSnapshot(session.userId)).defaultRegion).toBe(
      legacyRegion.defaultRegion,
    )
    expect(await readProfileEditSnapshot(foreignSession.userId)).toEqual(foreignBefore)

    const legacyScreenshot = await captureProfileEditScreenshot({
      focusTarget: regionSearchbox(page),
      page,
      state: "legacy",
      testInfo,
    })

    await assertInvalidRegionFocusWithoutPatch({ observedPatches, page, testInfo })

    await regionSearchbox(page).fill("없는지역검색어")
    await expect(
      page.getByText("일치하는 지역이 없어요. 목록에서 지역을 선택해 주세요."),
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "변경사항 저장" })).toBeDisabled()
    expect(observedPatches).toEqual([])
    expect(await readProfileEditSnapshot(session.userId)).toEqual(legacyBeforeSelection)

    await selectCanonicalRegion(page, "강남구", /서울특별시 · 강남구/u)
    await expect(page.getByRole("button", { name: "변경사항 저장" })).toBeEnabled()
    expect(observedPatches).toEqual([])
    expect(await readProfileEditSnapshot(session.userId)).toEqual(legacyBeforeSelection)

    const displayName = page.getByLabel("활동 이름 (필수)")
    await displayName.fill(" ")
    await displayName.press("Enter")
    await expect(displayName).toBeFocused()
    await expect(page.getByText("활동 이름은 2자 이상 입력해요.")).toBeVisible()
    expect(observedPatches).toEqual([])
    await displayName.fill(seed.displayName)

    const profileRefreshFinished = waitForProfileRefreshResponse(page)
    await page.getByRole("button", { name: "변경사항 저장" }).click()
    await expect(page.getByText("프로필 정보를 저장했어요.")).toBeVisible()
    await profileRefreshFinished
    expect(observedPatches).toEqual([{ defaultRegion: "서울특별시 강남구" }])
    expect(await readProfileEditSnapshot(session.userId)).toEqual({
      ...legacyBeforeSelection,
      defaultRegion: "서울특별시 강남구",
    })
    expect(await readProfileEditSnapshot(foreignSession.userId)).toEqual(foreignBefore)
    expect(observedFailures).toEqual([])
    expect(runtimeWatcher.failures).toEqual({
      apiMeRequests: 0,
      consoleErrors: [],
      requestFailures: [],
      responseFailures: [],
    })
    await appendProfileEditObservation({
      foreignUnchanged: true,
      legacyKind: legacyRegion.kind,
      legacyPreservedBeforeSelection: true,
      postSelectionPatchKeys: ["defaultRegion"],
      preSelectionPatchCount: 0,
      project: testInfo.project.name,
      scenario: "legacy-region-recovery",
      screenshotName: legacyScreenshot.name,
      type: "validation",
    })
  } finally {
    await page.unroute("**/api/profiles/me").catch((error: unknown) => {
      if (error instanceof Error) return null
      throw error
    })
    if (foreignSession) await cleanupProfileEditSession(foreignSession)
    if (session) await cleanupProfileEditSession(session)
  }
})

test("profile edit journey saves changed-only fields and persists after retry", async ({
  page,
}, testInfo) => {
  const expectedFailures = new Set(["server-500", "network-abort"])
  const observedFailures: string[] = []
  const runtimeWatcher = watchUnexpectedRuntimeFailures(page)
  let session: ProfileEditSession | null = null
  let foreignSession: ProfileEditSession | null = null
  const observedPatches: ObservedPatch[] = []

  try {
    foreignSession = await createProfileEditSession(page, testInfo, "foreign")
    await insertProfileEditProfile(foreignSession.userId, profileEditValues(testInfo, "foreign"))
    session = await createProfileEditSession(page, testInfo, "journey")
    const initial = {
      ...profileEditValues(testInfo, "initial"),
      defaultRegion: "서울특별시 강남구",
      locationAgreed: false,
      marketingAgreed: true,
    }
    const partial = {
      ...initial,
      displayName: profileEditValues(testInfo, "partial").displayName,
      locationAgreed: true,
    }
    const updated = {
      ...profileEditValues(testInfo, "updated"),
      defaultRegion: "서울특별시 서초구",
      locationAgreed: false,
      marketingAgreed: false,
    }
    await insertProfileEditProfile(session.userId, initial)
    const foreignBefore = await readProfileEditSnapshot(foreignSession.userId)

    await observeProfileEditPatchRoute({
      observedFailures,
      observedPatches,
      page,
      runtimeWatcher,
    })

    await page.goto("/")
    await expect(page.getByRole("link", { exact: true, name: "마이" })).toBeVisible()
    await page.getByRole("link", { exact: true, name: "마이" }).click()
    await expect(page).toHaveURL(/\/mypage$/u)
    await page.getByRole("link", { name: "내 정보 수정으로 이동" }).click()
    await expect(page).toHaveURL(/\/mypage\/profile$/u)
    await expect(page.getByRole("heading", { level: 1, name: "프로필 수정" })).toBeVisible()
    await expect(page.getByLabel("활동 이름 (필수)")).toHaveValue(initial.displayName)
    await expect(page.getByLabel("실명 (필수)")).toHaveValue(initial.realName)
    await expect(page.getByLabel("휴대폰 번호 (필수)")).toHaveValue(initial.phone)
    await expect(page.getByRole("button", { name: /서울특별시 · 강남구/u })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await savePartialProfileEditChange({ observedPatches, page, partial, testInfo })

    await regionSearchbox(page).fill("화성달기지")
    await expect(
      page.getByText("일치하는 지역이 없어요. 목록에서 지역을 선택해 주세요."),
    ).toBeVisible()
    await selectCanonicalRegion(page, "서초구", /서울특별시 · 서초구/u)
    await page.getByRole("button", { name: "지역 검색어 지우기" }).click()
    await expect(page.getByRole("button", { name: /서울특별시 · 서초구/u })).toHaveAttribute(
      "aria-pressed",
      "true",
    )

    await assertInvalidDisplayNameFocusWithoutPatch({ observedPatches, page })

    await page.getByLabel("활동 이름 (필수)").fill(updated.displayName)
    await page.getByLabel("실명 (필수)").fill(updated.realName)
    await page.getByLabel("휴대폰 번호 (필수)").fill(updated.phone)
    await setCheckbox(page.getByLabel("내 주변 레슨 안내를 위한 위치 이용에 동의해요."), false)
    await setCheckbox(page.getByLabel("혜택과 새로운 레슨 소식 수신에 동의해요."), false)

    const save = page.getByRole("button", { name: "변경사항 저장" })
    await save.click()
    await expect(profileEditAlert(page)).toContainText(
      "서버에서 프로필을 저장하지 못했어요. 잠시 후 다시 시도해요.",
    )
    await expect(profileEditAlert(page)).toBeFocused()
    await assertEditedValuesRetained(page, updated)

    await save.click()
    await expect(profileEditAlert(page)).toContainText(
      "연결이 원활하지 않아요. 잠시 후 다시 시도해요.",
    )
    await expect(profileEditAlert(page)).toBeFocused()
    await assertEditedValuesRetained(page, updated)

    const beforeDuplicateSubmitCount = observedPatches.length
    const profileRefreshFinished = waitForProfileRefreshResponse(page)
    const firstClick = save.click()
    const secondClick = save.click({ timeout: 250 }).catch((error: unknown) => {
      if (error instanceof Error) return null
      throw error
    })
    await Promise.all([firstClick, secondClick])
    const successConfirmation = page
      .getByRole("status")
      .filter({ hasText: "프로필 정보를 저장했어요." })
    await expect(successConfirmation).toBeVisible()
    expect(observedPatches.length - beforeDuplicateSubmitCount).toBe(1)

    const screenshot = await captureProfileEditScreenshot({
      focusTarget: page.getByLabel("활동 이름 (필수)"),
      page,
      state: "success",
      successConfirmation,
      testInfo,
    })

    await profileRefreshFinished

    const expectedPatch = {
      defaultRegion: updated.defaultRegion,
      displayName: updated.displayName,
      locationAgreed: false,
      marketingAgreed: false,
      phone: updated.phone,
      realName: updated.realName,
    } satisfies ObservedPatch
    expect(observedPatches).toEqual([
      { displayName: partial.displayName, locationAgreed: true },
      expectedPatch,
      expectedPatch,
      expectedPatch,
    ])
    for (const patch of observedPatches.slice(1)) {
      expect(Object.keys(patch).sort()).toEqual([...approvedPatchKeys].sort())
    }

    await expect(page).toHaveURL(/\/mypage\/profile$/u)
    await expect(save).toBeDisabled()
    await assertResponseFinished(await page.reload({ waitUntil: "domcontentloaded" }))
    await page.waitForLoadState("networkidle")
    await expect(successConfirmation).toHaveCount(0)
    await assertEditedValuesRetained(page, updated)
    await expect(page.getByRole("button", { name: "변경사항 저장" })).toBeDisabled()
    const persisted = await readProfileEditSnapshot(session.userId)
    const foreignAfter = await readProfileEditSnapshot(foreignSession.userId)
    expect(persisted.defaultRegion).toBe(updated.defaultRegion)
    expect(persisted.locationAgreed).toBe(false)
    expect(persisted.marketingAgreed).toBe(false)
    expect(foreignAfter).toEqual(foreignBefore)
    expect(new Set(observedFailures)).toEqual(expectedFailures)
    expect(runtimeWatcher.observedExpectedInjectedFailures()).toEqual(
      expectedProfileEditInjectedFailureReceipts(),
    )
    expect(runtimeWatcher.failures).toEqual({
      apiMeRequests: 0,
      consoleErrors: [],
      requestFailures: [],
      responseFailures: [],
    })

    await appendProfileEditObservation({
      duplicateSubmitPatchDelta: 1,
      expectedFailureCount: observedFailures.length,
      patchKeySets: observedPatches.map((patch) => Object.keys(patch).sort()),
      project: testInfo.project.name,
      postReloadPersistence: {
        canonicalDatabaseRegion: true,
        foreignProfileUnchanged: true,
        formReadback: true,
        successConfirmationPresent: false,
      },
      scenario: "complete-profile-edit-journey",
      screenshotName: screenshot.name,
      type: "scenario",
    })
  } finally {
    await page.unroute("**/api/profiles/me").catch((error: unknown) => {
      if (error instanceof Error) return null
      throw error
    })
    if (foreignSession) await cleanupProfileEditSession(foreignSession)
    if (session) await cleanupProfileEditSession(session)
  }
})
