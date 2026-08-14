import { createHash } from "node:crypto"
import { writeFile } from "node:fs/promises"

import { expect, type Page, type TestInfo, test } from "@playwright/test"

test("search picker preserves staged mobile filters and desktop structure", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  // Given: all runtime failures and the initial route are observed.
  const consoleErrors: string[] = []
  const failedAppRequests: string[] = []
  const pageErrors: string[] = []
  const appOrigin = new URL(testInfo.project.use.baseURL ?? "http://127.0.0.1").origin
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  page.on("pageerror", (error) => pageErrors.push(error.message))
  page.on("requestfailed", (request) => {
    if (
      new URL(request.url()).origin === appOrigin &&
      request.failure()?.errorText !== "net::ERR_ABORTED"
    ) {
      failedAppRequests.push(request.url())
    }
  })
  page.on("response", (response) => {
    if (new URL(response.url()).origin === appOrigin && response.status() >= 400) {
      failedAppRequests.push(response.url())
    }
  })
  const initialPath = "/lessons?region=서울&sport=테니스"
  const knownHitDate = demoScheduleKstDate(1, 1)
  const knownEmptyDate = demoScheduleKstDate(2, 1)
  const states = []
  await page.goto(initialPath, { waitUntil: "networkidle" })

  // When: the complete province-to-district path is exercised in each responsive picker.
  await openRegionAndSelectDistrict(page, testInfo)
  states.push(
    await captureState(page, testInfo, {
      consoleErrors,
      failedAppRequests,
      pageErrors,
      screenshotName: "search-region-drilldown.png",
      stateId: "search-region-drilldown",
    }),
  )

  // When: a fixed demo KST date is submitted through the responsive search control.
  await page.goto(initialPath, { waitUntil: "networkidle" })
  await applyDate(page, testInfo, knownHitDate)
  await expect(page.getByRole("heading", { name: "퇴근 후 50분 테니스 입문" })).toBeVisible()
  expect(new URL(page.url()).searchParams.get("date")).toBe(knownHitDate)
  const hitUrl = page.url()
  states.push(
    await captureState(page, testInfo, {
      consoleErrors,
      failedAppRequests,
      pageErrors,
      screenshotName: "search-kst-known-hit.png",
      stateId: "search-kst-known-hit",
    }),
  )

  // When: a known empty KST calendar day is loaded and reloaded.
  const emptyUrl = new URL(hitUrl)
  emptyUrl.searchParams.set("date", knownEmptyDate)
  await page.goto(emptyUrl.toString(), { waitUntil: "networkidle" })
  await expect(page.getByRole("heading", { name: /아직 조건에 맞는 레슨이 없어요/u })).toBeVisible()
  await page.reload({ waitUntil: "networkidle" })
  expect(new URL(page.url()).searchParams.get("date")).toBe(knownEmptyDate)
  states.push(
    await captureState(page, testInfo, {
      consoleErrors,
      failedAppRequests,
      pageErrors,
      screenshotName: "search-kst-empty.png",
      stateId: "search-kst-empty",
    }),
  )

  // When: browser history restores the exact known-hit search after the empty-state reload.
  await page.goBack({ waitUntil: "networkidle" })
  await expect(page).toHaveURL(hitUrl)
  await expect(page.getByRole("heading", { name: "퇴근 후 50분 테니스 입문" })).toBeVisible()
  states.push(
    await captureState(page, testInfo, {
      consoleErrors,
      failedAppRequests,
      pageErrors,
      screenshotName: "search-history-restored.png",
      stateId: "search-history-restored",
    }),
  )

  if (testInfo.project.use.viewport?.width === 390) {
    const trigger = page.getByRole("button", { name: /검색 조건:/u })
    await trigger.press("Enter")
    await page.getByRole("button", { name: "초기화" }).press("Enter")
    await page.keyboard.press("Escape")
    await expect(page.locator('dialog[aria-label="레슨 검색 조건"]')).not.toHaveJSProperty(
      "open",
      true,
    )
    await expect(trigger).toBeFocused()
    expect(page.url()).toBe(hitUrl)
    expect(await page.evaluate(() => document.body.style.position)).toBe("")
  }

  // Then: browser, network, focus, overflow, and all four named captures are clean.
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
  expect(failedAppRequests).toEqual([])
  expect(states).toHaveLength(4)
  await writeFile(
    testInfo.outputPath("direction-observation.json"),
    `${JSON.stringify({ states })}\n`,
    {
      mode: 0o600,
    },
  )
})

async function openRegionAndSelectDistrict(page: Page, testInfo: TestInfo) {
  if (testInfo.project.use.viewport?.width === 390) {
    await page.emulateMedia({ reducedMotion: "reduce" })
    const trigger = page.getByRole("button", { name: /검색 조건:/u })
    await trigger.press("Enter")
    const dialog = page.locator('dialog[aria-label="레슨 검색 조건"]')
    await expect(dialog).toHaveJSProperty("open", true)
    await expect(page.getByRole("tab", { name: "지역" })).toBeFocused()
    expect(await page.evaluate(() => document.body.style.position)).toBe("fixed")
    expect(
      await dialog.evaluate((element) => element.getAnimations({ subtree: true }).length),
    ).toBe(0)
    await page.keyboard.press("Shift+Tab")
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  } else {
    const segments = page.getByTestId("desktop-search-segments")
    await expect(segments.locator("[data-search-segment]")).toHaveCount(3)
    const submit = page.getByRole("button", { name: "검색" })
    const box = await submit.boundingBox()
    expect(box?.width).toBeGreaterThanOrEqual(44)
    expect(box?.height).toBeGreaterThanOrEqual(44)
    await segments.locator("[data-search-segment]").first().press("Enter")
  }
  const backToProvinces = page.getByRole("button", { name: "시·도 목록으로 돌아가기" })
  if ((await backToProvinces.count()) > 0) await backToProvinces.press("Enter")
  await page.getByRole("button", { name: "경기도", exact: true }).press("Enter")
  await page.getByRole("button", { name: "수원시장안구", exact: true }).press("Enter")
  await expect(page.locator('input[name="region"]')).toHaveValue("경기도 수원시장안구")
}

async function applyDate(page: Page, testInfo: TestInfo, date: string) {
  if (testInfo.project.use.viewport?.width === 390) {
    await page.getByRole("button", { name: /검색 조건:/u }).press("Enter")
    await page.getByRole("tab", { name: "일정" }).press("Enter")
    await page.locator('input[aria-label="레슨 날짜"]:visible').fill(date)
    await page.getByRole("button", { name: "검색 적용" }).press("Enter")
    return
  }
  const segments = page.getByTestId("desktop-search-segments")
  await segments.locator("[data-search-segment]").nth(2).press("Enter")
  await page.locator('input[aria-label="레슨 날짜"]:visible').fill(date)
  await page.getByRole("button", { name: "검색" }).press("Enter")
}

type CaptureInput = Readonly<{
  consoleErrors: readonly string[]
  failedAppRequests: readonly string[]
  pageErrors: readonly string[]
  screenshotName: string
  stateId: string
}>

async function captureState(page: Page, testInfo: TestInfo, input: CaptureInput) {
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  let focusEscaped = await page.evaluate(() => {
    const active = document.activeElement
    return active === null || active === document.body || !active.isConnected
  })
  if (focusEscaped) {
    await page.keyboard.press("Tab")
    focusEscaped = await page.evaluate(() => {
      const active = document.activeElement
      return active === null || active === document.body || !active.isConnected
    })
  }
  expect(horizontalOverflow).toBeLessThanOrEqual(0)
  expect(focusEscaped).toBe(false)
  const screenshotPath = testInfo.outputPath(input.screenshotName)
  const screenshot = await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: screenshotPath,
  })
  return {
    consoleErrorCount: input.consoleErrors.length,
    failedAppRequestCount: input.failedAppRequests.length,
    focusEscapeCount: focusEscaped ? 1 : 0,
    horizontalOverflow,
    pageErrorCount: input.pageErrors.length,
    project: testInfo.project.name,
    route: `${new URL(page.url()).pathname}${new URL(page.url()).search}`,
    screenshotPath,
    screenshotSha256: createHash("sha256").update(screenshot).digest("hex"),
    stateId: input.stateId,
    viewport: testInfo.project.use.viewport,
  }
}

function demoScheduleKstDate(daysFromTodayUtc: number, hourUtc: number) {
  const now = new Date()
  const instant = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysFromTodayUtc, hourUtc),
  )
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Seoul",
    year: "numeric",
  }).formatToParts(instant)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ""
  return `${value("year")}-${value("month")}-${value("day")}`
}
