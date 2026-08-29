import path from "node:path"

import type { Page, TestInfo } from "@playwright/test"
import postgres from "postgres"

import { testEmail, testPassword } from "./auth-form-helpers"
import {
  cleanupLiveAuthUser,
  createLiveAuthSession,
  toPlaywrightSupabaseCookies,
} from "./auth-recovery-helpers"
import {
  buildCoachDashboardFixturePlan,
  type CoachDashboardFixturePlan,
  type CoachDashboardPersonaAlias,
  cleanupCoachDashboardFixture,
  coachDashboardPersonaAliases,
  countCoachDashboardFixtureRows,
  seedCoachDashboardFixture,
} from "./coach-dashboard-fixtures"
import { shouldInjectCoachDashboardFailure } from "./coach-dashboard-injection"

type PersonaCookies = ReadonlyArray<Readonly<{ name: string; value: string }>>

export type CoachDashboardLiveFixture = Readonly<{
  capture: (name: string) => Promise<void>
  clearSession: () => Promise<void>
  forbiddenDomValues: readonly string[]
  markStage: (stage: string) => void
  plan: CoachDashboardFixturePlan
  runtimeErrors: string[]
  activatePersona: (alias: CoachDashboardPersonaAlias) => Promise<void>
}>

export async function withCoachDashboardLiveFixture(
  page: Page,
  testInfo: TestInfo,
  scenario: string,
  callback: (fixture: CoachDashboardLiveFixture) => Promise<void>,
) {
  const epoch = requireEnvironment("SPOLINK_COACH_DASHBOARD_EPOCH")
  const visualDir = requireEnvironment("SPOLINK_COACH_DASHBOARD_VISUAL_DIR")
  const plan = buildCoachDashboardFixturePlan(epoch)
  const emails = new Map<CoachDashboardPersonaAlias, string>()
  const users = new Map<CoachDashboardPersonaAlias, string>()
  const cookies = new Map<CoachDashboardPersonaAlias, PersonaCookies>()
  const runtimeErrors: string[] = []
  let scenarioError: unknown = null
  let cleanupError: AggregateError | null = null
  let cleanupCounts = {
    coachProfilesRemaining: -1,
    graphRowsRemaining: -1,
    profilesRemaining: -1,
    usersRemaining: -1,
  }
  let stage = "setup"
  const onConsole = (message: import("@playwright/test").ConsoleMessage) => {
    if (message.type() === "error") runtimeErrors.push(message.text())
  }
  const onPageError = (error: Error) => runtimeErrors.push(error.message)
  page.on("console", onConsole)
  page.on("pageerror", onPageError)

  try {
    for (const alias of coachDashboardPersonaAliases) {
      const email = testEmail(testInfo, `${scenario}-${alias}`)
      emails.set(alias, email)
      const session = await createLiveAuthSession(page, email, testPassword)
      users.set(alias, session.userId)
      cookies.set(alias, session.cookies)
    }
    await withDb((sql) => seedCoachDashboardFixture(sql, plan, users))
    if (shouldInjectCoachDashboardFailure(process.env)) {
      throw new CoachDashboardInjectedFailure()
    }

    const fixture: CoachDashboardLiveFixture = {
      capture: async (name) => {
        await page.screenshot({
          fullPage: true,
          path: path.join(visualDir, `coach-dashboard-${name}-desktop.png`),
        })
      },
      clearSession: async () => page.context().clearCookies(),
      forbiddenDomValues: [
        "PII_REAL_NAME_SENTINEL",
        "010-9999-9999",
        ...Object.values(plan.graph).flatMap((rows) => rows.map((row) => row.id)),
      ],
      markStage: (value) => {
        if (!/^[a-z0-9-]+$/u.test(value)) throw new Error("Invalid fixture stage alias")
        stage = value
      },
      plan,
      runtimeErrors,
      activatePersona: async (alias) => {
        const personaCookies = cookies.get(alias)
        if (!personaCookies) throw new Error(`Missing persona cookies: ${alias}`)
        await page.context().clearCookies()
        const origin = new URL(page.url()).origin
        await page.context().addCookies(toPlaywrightSupabaseCookies(origin, personaCookies))
      },
    }
    await callback(fixture)
  } catch (error) {
    scenarioError = error
  } finally {
    page.off("console", onConsole)
    page.off("pageerror", onPageError)
    const cleanupErrors: unknown[] = []
    try {
      await withDb((sql) => cleanupCoachDashboardFixture(sql, plan, users))
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
      cleanupCounts = await withDb((sql) => countCoachDashboardFixtureRows(sql, plan, users))
    } catch (error) {
      cleanupErrors.push(error)
    }
    console.log(
      `COACH_DASHBOARD_FIXTURE ${JSON.stringify({
        cleanup: cleanupCounts,
        scenario: `${scenario}:${stage}`,
      })}`,
    )
    if (cleanupErrors.length > 0) {
      cleanupError = new AggregateError(cleanupErrors, "Fixture cleanup failed")
    }
  }
  if (cleanupError) throw cleanupError
  if (scenarioError) throw scenarioError
}

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
  const sql = postgres(requireEnvironment("SPOLINK_AUTH_E2E_DB_URL"), {
    idle_timeout: 1,
    max: 1,
  })
  try {
    return await callback(sql)
  } finally {
    await sql.end({ timeout: 1 })
  }
}
