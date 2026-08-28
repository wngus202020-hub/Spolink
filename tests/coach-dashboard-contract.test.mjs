import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
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

const baselinePath = ".omo/evidence/coach-dashboard-screen/task-1/baseline.json"
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"))
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
]
const approvedNavigationDestinations = [
  "/coach/lessons/new",
  "/coach/lessons",
  "/coach/reservations",
  "/coach/settlements",
]

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function patchSha256(path) {
  return sha256(execFileSync("git", ["diff", "--no-ext-diff", "--binary", "--", path]))
}

function assertDashboardPageContract(pagePath) {
  assert.equal(existsSync(pagePath), true, `${pagePath} must exist`)

  const page = readFileSync(pagePath, "utf8")
  assert.match(page, /readApprovedCoachPage\("\/coach\/dashboard"\)/u)
  assert.match(page, /export const dynamic = "force-dynamic"/u)
  assert.match(page, /force-no-store/u)
  assert.match(page, /SPOLINK_COACH_DASHBOARD_UI_FIXTURES/u)
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

function assertNoPublicDashboardSurface(apiPath, migrationsPath) {
  assert.equal(existsSync(apiPath), false, `${apiPath} must not exist`)

  const migrationDashboardReferences = readdirSync(migrationsPath)
    .filter((file) => file.endsWith(".sql"))
    .filter((file) => readFileSync(join(migrationsPath, file), "utf8").includes("/coach/dashboard"))
  assert.deepEqual(migrationDashboardReferences, [])
}

test("Todo 1 baseline preserves existing dirty bytes and package scripts", () => {
  for (const file of baseline.files) {
    if (file.path === "package.json") continue

    assert.equal(sha256(readFileSync(file.path)), file.sha256, `${file.path} byte hash`)
    if (file.patchSha256)
      assert.equal(patchSha256(file.path), file.patchSha256, `${file.path} patch hash`)
  }

  const packageJson = JSON.parse(readFileSync("package.json", "utf8"))
  const { "test:e2e:coach-dashboard": dashboardScript, ...preExistingScripts } = packageJson.scripts
  assert.deepEqual(preExistingScripts, baseline.packageScripts)
  assert.equal(
    packageJson.scripts["staging:verify:smtp"],
    "node tests/staging-contract/verify-smtp-auth-flow.mjs --mailbox-provider mailtrap",
  )
  assert.ok(dashboardScript === undefined || dashboardScript === dashboardRunner)
})

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

  assert.match(header, /지도자 센터/u)
  assert.match(header, /\/coach\/dashboard/u)
})

test("downstream Todo 5 mypage exposes the approved coach center", () => {
  const mypage = readFileSync("app/mypage/page.tsx", "utf8")

  assert.match(mypage, /지도자 센터/u)
  assert.match(mypage, /\/coach\/dashboard/u)
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
    assert.throws(
      () => assertDashboardPageContract(fixturePage),
      /SPOLINK_COACH_DASHBOARD_UI_FIXTURES/u,
    )

    mkdirSync(fixtureApi, { recursive: true })
    assert.throws(
      () => assertNoPublicDashboardSurface(fixtureApi, fixtureMigrations),
      /must not exist/u,
    )
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true })
  }
})
