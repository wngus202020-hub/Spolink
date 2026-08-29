import assert from "node:assert/strict"
import test from "node:test"

import {
  createElement,
  emptyDashboard,
  findClickableElement,
  loadRequiredModule,
  renderToStaticMarkup,
  resetRuntime,
  runtime,
  setFixtureEnvironment,
} from "./coach-dashboard-page.harness.mjs"

test("coach UI fixture uiState is exact, scalar, and environment-gated", async (t) => {
  const { default: CoachDashboardPage } = await loadRequiredModule("app/coach/dashboard/page.tsx")
  const originalEnvironment = process.env["SPOLINK_COACH_DASHBOARD_UI_FIXTURES"]
  const originalLegacyEnvironment = process.env["SPOLINK_COACH_UI_FIXTURES"]
  process.env["SPOLINK_COACH_DASHBOARD_UI_FIXTURES"] = "preseeded-fixture-value"
  process.env["SPOLINK_COACH_UI_FIXTURES"] = "enabled"
  const previous = process.env["SPOLINK_COACH_DASHBOARD_UI_FIXTURES"]
  const scenarios = [
    [undefined, "error"],
    ["disabled", "loading"],
    ["enabled", ["error", "loading"]],
    ["enabled", "unexpected"],
  ]
  let restoredFixtureEnvironment

  try {
    for (const [environment, uiState] of scenarios) {
      await t.test(`${environment ?? "missing"}-${String(uiState)}`, async () => {
        setFixtureEnvironment(environment)
        resetRuntime(emptyDashboard)
        const html = renderToStaticMarkup(
          await CoachDashboardPage({ searchParams: Promise.resolve({ uiState }) }),
        )
        assert.match(html, /지도자 운영 센터/u)
        assert.deepEqual(
          runtime.calls.map((call) => call[0]),
          ["auth", "read-model"],
        )
      })
    }

    setFixtureEnvironment("enabled")
    resetRuntime(emptyDashboard)
    const errorFixtureHtml = renderToStaticMarkup(
      await CoachDashboardPage({ searchParams: Promise.resolve({ uiState: "error" }) }),
    )
    assert.match(errorFixtureHtml, /role="alert"/u)
    assert.match(errorFixtureHtml, /지도자 운영 현황을 불러오지 못했어요/u)
    assert.deepEqual(runtime.calls, [["auth", "/coach/dashboard"]])

    const originalSetTimeout = globalThis.setTimeout
    const delays = []
    globalThis.setTimeout = (callback, delay) => {
      delays.push(delay)
      callback()
      return 1
    }
    try {
      resetRuntime(emptyDashboard)
      const loadingResultHtml = renderToStaticMarkup(
        await CoachDashboardPage({ searchParams: Promise.resolve({ uiState: "loading" }) }),
      )
      assert.deepEqual(delays, [2_000])
      assert.match(loadingResultHtml, /지도자 운영 센터/u)
      assert.deepEqual(
        runtime.calls.map((call) => call[0]),
        ["auth", "read-model"],
      )
    } finally {
      globalThis.setTimeout = originalSetTimeout
    }
  } finally {
    setFixtureEnvironment(previous)
    restoredFixtureEnvironment = process.env["SPOLINK_COACH_DASHBOARD_UI_FIXTURES"]
    setFixtureEnvironment(originalEnvironment)
    restoreEnvironment("SPOLINK_COACH_UI_FIXTURES", originalLegacyEnvironment)
  }
  assert.equal(restoredFixtureEnvironment, "preseeded-fixture-value")
})

test("loading and error states expose accessible operational recovery", async () => {
  const { default: CoachDashboardLoading } = await loadRequiredModule(
    "app/coach/dashboard/loading.tsx",
  )
  const { default: CoachDashboardError } = await loadRequiredModule("app/coach/dashboard/error.tsx")
  const { default: CoachDashboardRecoveryView } = await loadRequiredModule(
    "app/coach/dashboard/coach-dashboard-recovery-view.tsx",
  )
  const previousWindow = globalThis.window
  let resetCount = 0
  runtime.focusCount = 0
  runtime.routes = []
  runtime.search = "uiState=error"

  globalThis.window = { location: { assign: (href) => runtime.routes.push(href) } }
  try {
    const loadingHtml = renderToStaticMarkup(createElement(CoachDashboardLoading))
    runtime.search = "uiState=error&tab=overview"
    const fixtureError = new Error("Deterministic coach dashboard error fixture")
    fixtureError.name = "CoachDashboardFixtureError"
    const errorElement = CoachDashboardError({
      error: fixtureError,
      reset: () => (resetCount += 1),
    })
    const errorRecoveryElement = errorElement.type(errorElement.props)
    const errorHtml = renderToStaticMarkup(errorElement)
    findClickableElement(errorRecoveryElement).props.onClick()

    const fixtureRecoveryElement = CoachDashboardRecoveryView({})
    findClickableElement(fixtureRecoveryElement).props.onClick()

    assert.match(loadingHtml, /aria-busy="true"/u)
    assert.match(loadingHtml, /role="status"/u)
    assert.match(loadingHtml, /지도자 운영 현황을 불러오는 중입니다/u)
    assert.equal(runtime.focusCount, 3)
    assert.equal(resetCount, 1)
    assert.deepEqual(runtime.routes, ["/coach/dashboard?tab=overview"])

    const ordinaryErrorElement = CoachDashboardError({
      error: new Error("Ordinary dashboard read failure"),
      reset: () => (resetCount += 1),
    })
    const ordinaryRecoveryElement = ordinaryErrorElement.type(ordinaryErrorElement.props)
    findClickableElement(ordinaryRecoveryElement).props.onClick()
    assert.equal(resetCount, 2)
    assert.deepEqual(runtime.routes, ["/coach/dashboard?tab=overview"])
    console.log(
      `DASHBOARD_ERROR_RECOVERY ${JSON.stringify({
        fixtureRecovery: { route: "/coach/dashboard?tab=overview" },
        errorBoundary: { resetCalls: 2, routeChanges: 0 },
      })}`,
    )
    assert.match(errorHtml, /role="alert"/u)
    assert.match(errorHtml, /tabindex="-1"/u)
    assert.match(errorHtml, /지도자 운영 현황을 불러오지 못했어요/u)
    assert.match(errorHtml, />다시 시도</u)
    assert.doesNotMatch(errorHtml, /database|query|supabase|stack|error:/iu)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

function restoreEnvironment(key, value) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}
