import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import test from "node:test"
import { tmpdir } from "node:os"

const baselinePath = ".omo/evidence/coach-dashboard-screen/task-1/baseline.json"
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"))
const dashboardRunner = "node tests/auth-ui-e2e/run-coach-dashboard.mjs"
const dashboardPagePath = "app/coach/dashboard/page.tsx"
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
  for (const destination of approvedNavigationDestinations) assert.ok(page.includes(destination), destination)
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
    if (file.patchSha256) assert.equal(patchSha256(file.path), file.patchSha256, `${file.path} patch hash`)
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

test("downstream dashboard route uses the approved-coach boundary before rendering", () => {
  assertDashboardPageContract(dashboardPagePath)
})

test("downstream dashboard UI fixtures are guarded and navigation is approved", () => {
  assertDashboardPageContract(dashboardPagePath)
})

test("downstream dashboard creates neither a public API nor a migration", () => {
  assertNoPublicDashboardSurface("app/api/coach/dashboard", "supabase/migrations")
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
    assert.throws(() => assertDashboardPageContract(fixturePage), /SPOLINK_COACH_DASHBOARD_UI_FIXTURES/u)

    mkdirSync(fixtureApi, { recursive: true })
    assert.throws(
      () => assertNoPublicDashboardSurface(fixtureApi, fixtureMigrations),
      /must not exist/u,
    )
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true })
  }
})
