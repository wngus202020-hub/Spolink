import { test } from "@playwright/test"

import { runCoachDashboardAccessScenario } from "./coach-dashboard-access-scenario"
import { runCoachDashboardPopulatedScenario } from "./coach-dashboard-populated-scenario"
import { runCoachDashboardVisualScenario } from "./coach-dashboard-visual-scenario"

test("populated owner data and navigation", async ({ page }, testInfo) => {
  await runCoachDashboardPopulatedScenario(page, testInfo)
})

test("redirect matrix and ownership isolation", async ({ page }, testInfo) => {
  await runCoachDashboardAccessScenario(page, testInfo)
})

test("visual responsive states", async ({ page }, testInfo) => {
  await runCoachDashboardVisualScenario(page, testInfo)
})
