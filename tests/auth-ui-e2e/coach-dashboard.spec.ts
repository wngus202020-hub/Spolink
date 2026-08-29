import path from "node:path"

import { expect, test } from "@playwright/test"
import postgres from "postgres"

import { testEmail, testPassword } from "./auth-form-helpers"
import {
  cleanupLiveAuthUser,
  createLiveAuthSession,
  toPlaywrightSupabaseCookies,
} from "./auth-recovery-helpers"
import {
  buildCoachDashboardFixturePlan,
  type CoachDashboardPersonaAlias,
  cleanupCoachDashboardFixture,
  coachDashboardPersonaAliases,
  countCoachDashboardFixtureRows,
  seedCoachDashboardFixture,
} from "./coach-dashboard-fixtures"
import { shouldInjectCoachDashboardFailure } from "./coach-dashboard-injection"

test("coach dashboard lifecycle foundation renders one approved-owner smoke view", async ({
  page,
}, testInfo) => {
  const epoch = requireEnvironment("SPOLINK_COACH_DASHBOARD_EPOCH")
  const visualDir = requireEnvironment("SPOLINK_COACH_DASHBOARD_VISUAL_DIR")
  const plan = buildCoachDashboardFixturePlan(epoch)
  const emails = new Map<CoachDashboardPersonaAlias, string>()
  const users = new Map<CoachDashboardPersonaAlias, string>()
  let ownerCookies: ReadonlyArray<Readonly<{ name: string; value: string }>> = []
  let dbRowsRemaining = -1
  let usersRemaining = -1
  let scenario = "happy"
  let scenarioError: unknown = null
  let cleanupError: AggregateError | null = null

  try {
    for (const alias of coachDashboardPersonaAliases) {
      const email = testEmail(testInfo, alias)
      emails.set(alias, email)
      const session = await createLiveAuthSession(page, email, testPassword)
      users.set(alias, session.userId)
      if (alias === "approved-owner") ownerCookies = session.cookies
    }
    await withDb((sql) => seedCoachDashboardFixture(sql, plan, users))
    if (shouldInjectCoachDashboardFailure(process.env)) {
      scenario = "injected-failure"
      throw new CoachDashboardInjectedFailure()
    }

    const origin = new URL(page.url()).origin
    await page.context().addCookies(toPlaywrightSupabaseCookies(origin, ownerCookies))
    const response = await page.goto("/coach/dashboard")
    expect(response?.status()).toBe(200)
    await expect(page.getByRole("heading", { level: 1, name: "지도자 운영 센터" })).toBeVisible()
    await expect(page.getByText("소유 레슨", { exact: true }).first()).toBeVisible()
    await page.screenshot({
      fullPage: true,
      path: path.join(visualDir, "coach-dashboard-foundation-desktop.png"),
    })
  } catch (error) {
    scenarioError = error
  } finally {
    const cleanupErrors: unknown[] = []
    try {
      await withDb((sql) => cleanupCoachDashboardFixture(sql, plan))
    } catch (error) {
      cleanupErrors.push(error)
    }
    for (const alias of coachDashboardPersonaAliases) {
      const email = emails.get(alias)
      if (!email) continue
      try {
        await cleanupLiveAuthUser(email)
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    try {
      dbRowsRemaining = await withDb((sql) => countCoachDashboardFixtureRows(sql, plan))
      usersRemaining = await withDb(async (sql) => {
        const rows = await sql<{ count: number }[]>`
          select count(*)::int as count from auth.users
          where email = any(${[...emails.values()]}::text[])
        `
        return rows[0]?.count ?? -1
      })
    } catch (error) {
      cleanupErrors.push(error)
    }
    console.log(
      `COACH_DASHBOARD_FIXTURE ${JSON.stringify({
        cleanup: { dbRowsRemaining, usersRemaining },
        scenario,
      })}`,
    )
    if (cleanupErrors.length > 0) {
      cleanupError = new AggregateError(cleanupErrors, "Fixture cleanup failed")
    }
  }
  if (cleanupError) throw cleanupError
  if (scenarioError) throw scenarioError
})

class CoachDashboardInjectedFailure extends Error {
  constructor() {
    super("Injected coach dashboard failure after seed")
    this.name = "CoachDashboardInjectedFailure"
  }
}

function requireEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function withDb<T>(callback: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const dbUrl = requireEnvironment("SPOLINK_AUTH_E2E_DB_URL")
  const sql = postgres(dbUrl, { idle_timeout: 1, max: 1 })
  try {
    return await callback(sql)
  } finally {
    await sql.end({ timeout: 1 })
  }
}
