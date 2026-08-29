import assert from "node:assert/strict"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const dashboardRunner = "node tests/auth-ui-e2e/run-coach-dashboard.mjs"
const dashboardPagePath = "app/coach/dashboard/page.tsx"
const dashboardComponentPaths = [
  "components/coach/coach-dashboard-activity.tsx",
  "components/coach/coach-dashboard-overview.tsx",
  "components/coach/coach-dashboard-schedule.tsx",
]
const dashboardStatePaths = [
  "app/coach/dashboard/page.tsx",
  "app/coach/dashboard/loading.tsx",
  "app/coach/dashboard/error.tsx",
  "app/coach/dashboard/coach-dashboard-recovery-view.tsx",
]
const dashboardRecoveryViewPath = "app/coach/dashboard/coach-dashboard-recovery-view.tsx"
const approvedNavigationDestinations = [
  "/coach/lessons/new",
  "/coach/lessons",
  "/coach/reservations",
  "/coach/settlements",
]

function assertDashboardPageContract(pagePath) {
  assert.equal(existsSync(pagePath), true, `${pagePath} must exist`)

  const page = readFileSync(pagePath, "utf8")
  assert.match(page, /readApprovedCoachPage\("\/coach\/dashboard"\)/u)
  assert.match(page, /export const dynamic = "force-dynamic"/u)
  assert.match(page, /force-no-store/u)
  assert.match(page, /SPOLINK_COACH_UI_FIXTURES/u)
  assert.match(page, /=== "enabled"/u)
  assert.ok(
    page.indexOf('readApprovedCoachPage("/coach/dashboard")') <
      page.indexOf("readCoachDashboard({"),
    "approved-coach boundary must run before dashboard reads",
  )
}

function assertDashboardPresentationContract(componentPaths) {
  const source = componentPaths.map((path) => readFileSync(path, "utf8")).join("\n")
  for (const destination of approvedNavigationDestinations) {
    assert.ok(source.includes(destination), destination)
  }
  assert.doesNotMatch(source, /service.role|service_role|createSupabaseServiceClient/u)
}

function assertDashboardFixtureRecoveryContract() {
  const page = readFileSync(dashboardPagePath, "utf8")
  const errorBoundary = readFileSync("app/coach/dashboard/error.tsx", "utf8")
  const recoveryView = readFileSync(dashboardRecoveryViewPath, "utf8")

  assert.match(page, /import CoachDashboardRecoveryView from "\.\/coach-dashboard-recovery-view"/u)
  assert.match(
    page,
    /if \(fixtureState === "error"\) \{\s*return <CoachDashboardRecoveryView \/>\s*\}/u,
  )
  assert.doesNotMatch(page, /CoachDashboardFixtureError/u)
  assert.match(errorBoundary, /<CoachDashboardRecoveryView onRetry=\{reset\} \/>/u)
  assert.doesNotMatch(errorBoundary, /CoachDashboardFixtureError/u)
  assert.match(recoveryView, /^"use client"/u)
  assert.match(recoveryView, /nextSearchParams\.delete\("uiState"\)/u)
  assert.match(recoveryView, /window\.location\.assign\(/u)
  assert.match(recoveryView, /role="alert"/u)
  assert.match(recoveryView, /tabIndex=\{-1\}/u)
}

function assertNoPublicDashboardSurface(apiPath, migrationsPath) {
  assert.equal(existsSync(apiPath), false, `${apiPath} must not exist`)

  const migrationDashboardReferences = readdirSync(migrationsPath)
    .filter((file) => file.endsWith(".sql"))
    .filter((file) => readFileSync(join(migrationsPath, file), "utf8").includes("/coach/dashboard"))
  assert.deepEqual(migrationDashboardReferences, [])
}

test("Todo 1 runner wiring owns only the focused coach dashboard command", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"))

  assert.equal(packageJson.scripts["test:e2e:coach-dashboard"], dashboardRunner)
})

test("Todo 4 dashboard route uses the approved-coach boundary before rendering", () => {
  assertDashboardPageContract(dashboardPagePath)
})

test("Todo 4 dashboard UI fixtures are guarded and quick actions are approved", () => {
  assertDashboardPageContract(dashboardPagePath)
  assertDashboardPresentationContract(dashboardComponentPaths)
})

test("Todo 8 fixture error renders recovery directly and real errors retain reset semantics", () => {
  assertDashboardFixtureRecoveryContract()
})

test("Todo 4 dashboard uses no arbitrary numeric typography spacing or layout utilities", () => {
  const source = [...dashboardStatePaths, ...dashboardComponentPaths]
    .map((path) => readFileSync(path, "utf8"))
    .join("\n")
  const forbiddenUtilities = source.match(/[A-Za-z0-9:_/-]+-\[[^\]]*\d[^\]]*\]/gu) ?? []

  assert.deepEqual(forbiddenUtilities, [])
})

test("Todo 4 dashboard creates neither a public API nor a migration", () => {
  assertNoPublicDashboardSurface("app/api/coach/dashboard", "supabase/migrations")
})

test("downstream Todo 5 header navigation exposes the approved coach center", () => {
  const header = readFileSync("components/layout/public-header.tsx", "utf8")
  const navigation = readFileSync("lib/auth/coach-navigation.ts", "utf8")

  assert.match(header, /getCoachNavigationEntry\(auth\)/u)
  assert.match(navigation, /headerLabel: "지도자 센터"/u)
  assert.match(navigation, /href: "\/coach\/dashboard"/u)
})

test("downstream Todo 5 mypage exposes the approved coach center", () => {
  const mypage = readFileSync("app/mypage/page.tsx", "utf8")
  const navigation = readFileSync("lib/auth/coach-navigation.ts", "utf8")

  assert.match(mypage, /getCoachNavigationEntry\(auth\)/u)
  assert.match(navigation, /cardLabel: "지도자 센터"/u)
  assert.match(navigation, /href: "\/coach\/dashboard"/u)
})

test("adversarial fixtures reject an unguarded UI state and public dashboard API", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "spolink-coach-dashboard-contract-"))
  const fixturePage = join(fixtureRoot, "page.tsx")
  const fixtureApi = join(fixtureRoot, "api", "coach", "dashboard")
  const fixtureMigrations = join(fixtureRoot, "migrations")

  try {
    mkdirSync(fixtureMigrations, { recursive: true })
    writeFileSync(
      fixturePage,
      `export const dynamic = "force-dynamic"\nexport const fetchCache = "force-no-store"\nawait readApprovedCoachPage("/coach/dashboard")\n${approvedNavigationDestinations.join("\n")}`,
    )
    assert.throws(() => assertDashboardPageContract(fixturePage), /SPOLINK_COACH_UI_FIXTURES/u)

    mkdirSync(fixtureApi, { recursive: true })
    assert.throws(
      () => assertNoPublicDashboardSurface(fixtureApi, fixtureMigrations),
      /must not exist/u,
    )
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true })
  }
})
