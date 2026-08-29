import { expect, type Page, type TestInfo } from "@playwright/test"

import { withCoachDashboardLiveFixture } from "./coach-dashboard-live-fixture"
import {
  assertRenderedDarkContrast,
  captureCoachDashboardVisual,
} from "./coach-dashboard-visual-browser"

export async function runCoachDashboardVisualScenario(page: Page, testInfo: TestInfo) {
  const project = projectAlias(testInfo.project.name)
  const visualDir = requireVisualDirectory()
  await withCoachDashboardLiveFixture(page, testInfo, "visual-responsive", async (fixture) => {
    const captures: Array<Record<string, boolean | number | string>> = []
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" })

    fixture.markStage(`${project}-populated`)
    await fixture.activatePersona("approved-owner")
    let runtimeStart = fixture.runtimeErrors.length
    await page.goto("/coach/dashboard")
    await expect(page.getByRole("heading", { name: "지도자 운영 센터" })).toBeVisible()
    captures.push({
      ...(await captureCoachDashboardVisual({
        name: screenshotName("populated", project, "light"),
        onFailure: (issue) => fixture.markStage(`${project}-populated-${issue}`),
        page,
        runtimeErrors: fixture.runtimeErrors,
        runtimeErrorsBefore: runtimeStart,
        visualDir,
      })),
      scheme: "light",
      state: "populated",
    })

    fixture.markStage(`${project}-empty`)
    await fixture.activatePersona("empty-coach")
    runtimeStart = fixture.runtimeErrors.length
    await page.goto("/coach/dashboard")
    await expect(page.getByText("오늘 예정된 일정이 없습니다.", { exact: true })).toBeVisible()
    captures.push({
      ...(await captureCoachDashboardVisual({
        name: screenshotName("empty", project, "light"),
        onFailure: (issue) => fixture.markStage(`${project}-empty-${issue}`),
        page,
        runtimeErrors: fixture.runtimeErrors,
        runtimeErrorsBefore: runtimeStart,
        visualDir,
      })),
      scheme: "light",
      state: "empty",
    })

    fixture.markStage(`${project}-loading`)
    await fixture.activatePersona("approved-owner")
    runtimeStart = fixture.runtimeErrors.length
    await page.goto("/lessons")
    const centerLink = page.getByRole("link", { name: "지도자 센터", exact: true })
    await centerLink.evaluate((element) => {
      element.setAttribute("href", "/coach/dashboard?uiState=loading")
    })
    await centerLink.click({ noWaitAfter: true })
    const loadingStatus = page.getByText("지도자 운영 현황을 불러오는 중입니다.", {
      exact: true,
    })
    await expect(loadingStatus).toBeVisible()
    captures.push({
      ...(await captureCoachDashboardVisual({
        name: screenshotName("loading", project, "light"),
        onFailure: (issue) => fixture.markStage(`${project}-loading-${issue}`),
        page,
        runtimeErrors: fixture.runtimeErrors,
        runtimeErrorsBefore: runtimeStart,
        visualDir,
      })),
      loadingObserved: true,
      scheme: "light",
      state: "loading",
    })
    await expect(page.getByRole("heading", { name: "지도자 운영 센터" })).toBeVisible({
      timeout: 10_000,
    })

    fixture.markStage(`${project}-error`)
    runtimeStart = fixture.runtimeErrors.length
    const errorResponse = await page.goto("/coach/dashboard?uiState=error")
    fixture.markStage(`${project}-error-status-${statusAlias(errorResponse?.status())}`)
    const errorHeading = page.getByRole("heading", {
      name: "지도자 운영 현황을 불러오지 못했어요",
    })
    await expect(errorHeading).toBeVisible()
    fixture.markStage(`${project}-error-visible`)
    await expect(errorHeading).toBeFocused()
    fixture.markStage(`${project}-error-focused`)
    captures.push({
      ...(await captureCoachDashboardVisual({
        focusRequired: true,
        name: screenshotName("error", project, "light"),
        onFailure: (issue) => fixture.markStage(`${project}-error-${issue}`),
        page,
        runtimeErrors: fixture.runtimeErrors,
        runtimeErrorsBefore: runtimeStart,
        visualDir,
      })),
      errorFocused: true,
      scheme: "light",
      state: "error",
    })
    const retry = page.getByRole("button", { name: "다시 시도" })
    await retry.focus()
    await page.keyboard.press("Enter")
    await expect(page).toHaveURL(/\/coach\/dashboard$/u)
    await expect(page.getByRole("heading", { name: "지도자 운영 센터" })).toBeVisible()

    if (project !== "tablet") {
      fixture.markStage(`${project}-dark`)
      await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" })
      runtimeStart = fixture.runtimeErrors.length
      await page.goto("/coach/dashboard")
      expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(
        true,
      )
      const contrast = await assertRenderedDarkContrast(page)
      captures.push({
        ...(await captureCoachDashboardVisual({
          name: screenshotName("populated", project, "dark"),
          onFailure: (issue) => fixture.markStage(`${project}-dark-${issue}`),
          page,
          runtimeErrors: fixture.runtimeErrors,
          runtimeErrorsBefore: runtimeStart,
          visualDir,
        })),
        ...contrast,
        scheme: "dark",
        state: "populated",
      })
    }

    expect(fixture.runtimeErrors).toEqual([])
    fixture.markStage("complete")
    console.log(
      `COACH_DASHBOARD_VISUAL ${JSON.stringify({
        captures,
        project,
        verdict: "APPROVE",
      })}`,
    )
  })
}

function projectAlias(name: string): "desktop" | "mobile" | "tablet" {
  if (name === "desktop-chromium") return "desktop"
  if (name === "mobile-chromium") return "mobile"
  if (name === "tablet-chromium") return "tablet"
  throw new Error(`Unsupported visual project: ${name}`)
}

function screenshotName(state: string, project: string, scheme: string) {
  return `coach-dashboard-${state}-${project}-${scheme}.png`
}

function requireVisualDirectory() {
  const value = process.env["SPOLINK_COACH_DASHBOARD_VISUAL_DIR"]
  if (!value) throw new Error("SPOLINK_COACH_DASHBOARD_VISUAL_DIR is required")
  return value
}

function statusAlias(status: number | undefined) {
  if (status === undefined) return "none"
  if (status >= 200 && status < 300) return "success"
  if (status >= 400 && status < 500) return "client"
  if (status >= 500) return "server"
  return "other"
}
