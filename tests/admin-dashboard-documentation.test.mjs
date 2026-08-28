import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"

const screenDocumentPath = "SPOLINK_화면_설계.md"
const adminGuidePath = "app/admin/AGENTS.md"
const dashboardPagePath = "app/admin/page.tsx"
const countReaderPath = "lib/admin/dashboard-read-model.ts"
const choice3aWording =
  "3A: failing-first TDD plus managed responsive Playwright verification at 390/768/1280, local-only."

const expectedQueues = [
  {
    countKey: "coachApplications",
    label: "지도자 심사",
    sourceStatus: /from\("coach_profiles"\)[\s\S]*?eq\("status", "submitted"\)/u,
    status: "submitted",
    url: "/admin/coaches?status=submitted&page=1&pageSize=20",
  },
  {
    countKey: "lessonReviews",
    label: "레슨 승인",
    sourceStatus: /from\("lessons"\)[\s\S]*?eq\("status", "pending_review"\)/u,
    status: "pending_review",
    url: "/admin/lessons",
  },
  {
    countKey: "openReports",
    label: "신고 처리",
    sourceStatus: /from\("reports"\)[\s\S]*?in\("status", \["submitted", "reviewing"\]\)/u,
    status: "submitted+reviewing",
    url: "/admin/reports?status=open&page=1&pageSize=20",
  },
  {
    countKey: "disputedReservations",
    label: "분쟁 예약",
    sourceStatus: /from\("reservations"\)[\s\S]*?eq\("status", "disputed"\)/u,
    status: "disputed",
    url: "/admin/reservations?status=disputed&page=1&pageSize=20",
  },
  {
    countKey: "heldSettlements",
    label: "정산 보류",
    sourceStatus: /from\("settlements"\)[\s\S]*?eq\("status", "hold"\)/u,
    status: "hold",
    url: "/admin/settlements?status=hold",
  },
]

test("administrator dashboard source and screen document bind the same five normalized queues", () => {
  const sourceMatrix = readSourceMatrix()
  const screenMatrix = readScreenMatrix(readScreenDocument())

  assert.deepEqual(screenMatrix, sourceMatrix)
  assert.equal(screenMatrix.length, 5)
  maybePrintMatrix(sourceMatrix, screenMatrix)
})

test("administrator home documents the local-only count snapshot and 1A/2A boundaries", () => {
  const screen = readScreenDocument()
  const section = readAdminHomeSection(screen)

  assert.match(section, /auth\.kind === "ready"/u)
  assert.match(section, /profile\.role === "admin"/u)
  assert.match(section, /profile\.status === "active"/u)
  assert.match(section, /동시에.*count-only/u)
  assert.match(section, /best-effort.*load-time snapshot/u)
  assert.match(section, /어느 하나의 count 읽기라도 실패하면.*전체 페이지 오류/u)
  assert.match(section, /0건.*링크/u)
  assert.match(section, /HTTP endpoint.*추가하지 않는다/u)
  assert.match(section, /행 미리 보기|row preview/u)
  assert.match(section, /개인식별정보|PII/u)
  assert.match(section, /mutation/u)
  assert.match(section, /strong transactional snapshot/u)
  assert.match(section, /polling|Realtime/u)
  assert.match(section, /1A/u)
  assert.match(section, /2A/u)
  assert.match(section, /local-only Supabase/u)
  assert.match(section, /Hosted Supabase[\s\S]*deferred/u)
  assert.doesNotMatch(section, /\/api\/admin\/dashboard/u)
})

test("administrator screen and contributor guide align on the approved 3A wording", () => {
  const section = readAdminHomeSection(readScreenDocument())
  const guide = readFileSync(adminGuidePath, "utf8")
  const choicePattern = new RegExp(escapeForRegExp(choice3aWording), "u")

  assert.match(section, choicePattern)
  assert.match(guide, choicePattern)
})

test("admin contributor guide inventories the dashboard surface and focused verification commands", () => {
  const guide = readFileSync(adminGuidePath, "utf8")

  assert.match(guide, /^├── \.\/\s+# Five count-only operational queues$/mu)
  assert.match(guide, /`\/admin`.*count-only/u)
  assert.match(guide, /node --test tests\/admin-dashboard-documentation\.test\.mjs/u)
  assert.match(guide, /corepack pnpm test:e2e:task-10/u)
})

test("documentation parser rejects a missing lesson queue and a dashboard HTTP endpoint claim", () => {
  const screen = readFileSync(screenDocumentPath, "utf8")

  assert.throws(() => readScreenMatrix(withFixture(screen, "omit-lesson")), /레슨 승인/u)
  assert.throws(
    () => assertNoDashboardEndpoint(withFixture(screen, "dashboard-endpoint")),
    /HTTP endpoint/u,
  )
})

function readSourceMatrix() {
  const page = readFileSync(dashboardPagePath, "utf8")
  const countReader = readFileSync(countReaderPath, "utf8")

  return expectedQueues.map(({ countKey, label, sourceStatus, status, url }) => {
    const queuePattern = new RegExp(
      `count: counts\\.${countKey},[\\s\\S]*?href: "${escapeForRegExp(url)}",[\\s\\S]*?label: "${label}"`,
      "u",
    )
    assert.match(
      page,
      queuePattern,
      `${label} dashboard queue must retain its count and destination`,
    )
    assert.match(countReader, sourceStatus, `${label} count must retain its exact status predicate`)
    return { label, status, url }
  })
}

function readScreenMatrix(screen) {
  assertNoDashboardEndpoint(screen)
  const section = readAdminHomeSection(screen)

  return expectedQueues.map(({ label, status, url }) => {
    const rowPattern = new RegExp(
      `^\\| ${label} \\| \\x60${escapeForRegExp(status)}\\x60 \\| \\x60${escapeForRegExp(url)}\\x60 \\|$`,
      "mu",
    )
    assert.equal(
      rowPattern.test(section),
      true,
      `${label} documentation row is missing or has drifted`,
    )
    return { label, status, url }
  })
}

function readAdminHomeSection(screen) {
  const match = /^## 23\. 관리자 홈\n([\s\S]*?)(?=^## 24\. 관리자 지도자 인증\n)/mu.exec(screen)
  assert.ok(match?.[1], "administrator home section must remain bounded by sections 23 and 24")
  return match[1]
}

function assertNoDashboardEndpoint(screen) {
  assert.equal(/\/api\/admin\/dashboard/u.test(screen), false, "dashboard has no HTTP endpoint")
}

function readScreenDocument() {
  return withFixture(
    readFileSync(screenDocumentPath, "utf8"),
    process.env["SPOLINK_ADMIN_DASHBOARD_DOCUMENTATION_FIXTURE"],
  )
}

function withFixture(screen, fixture) {
  if (fixture === undefined || fixture === "") return screen
  if (fixture === "omit-lesson") return screen.replace(/^\| 레슨 승인 \|.*\n/mu, "")
  if (fixture === "dashboard-endpoint") return `${screen}\n/api/admin/dashboard\n`
  throw new Error(`Unknown documentation fixture: ${fixture}`)
}

function maybePrintMatrix(sourceMatrix, screenMatrix) {
  if (process.env["SPOLINK_ADMIN_DASHBOARD_DOC_PARSER"] !== "matrix") return
  const matrix = { screen: screenMatrix, source: sourceMatrix }
  console.log(`DOCUMENTATION_MATRIX ${JSON.stringify(matrix)}`)
  console.log(
    `DOCUMENTATION_MATRIX_SHA256 ${createHash("sha256").update(JSON.stringify(matrix)).digest("hex")}`,
  )
}

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}
