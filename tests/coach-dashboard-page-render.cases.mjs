import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import {
  emptyDashboard,
  loadRequiredModule,
  populatedDashboard,
  readHeadings,
  readHrefs,
  renderToStaticMarkup,
  resetRuntime,
  runtime,
} from "./coach-dashboard-page.harness.mjs"

test("dashboard populated HTML", async () => {
  const { default: CoachDashboardPage } = await loadRequiredModule("app/coach/dashboard/page.tsx")
  resetRuntime(populatedDashboard)

  const html = renderToStaticMarkup(await CoachDashboardPage({ searchParams: Promise.resolve({}) }))

  assert.deepEqual(runtime.calls, [
    ["auth", "/coach/dashboard"],
    ["read-model", "coach-owned", "profile-owned", "rls-aware-client"],
  ])
  for (const text of [
    "지도자 운영 센터",
    "승인 완료",
    "결제 대기",
    "2건",
    "예약 확정",
    "3건",
    "완료 처리 대기",
    "정산 예정",
    "33,000원",
    "오늘 일정",
    "12:00",
    "14:00",
    "테니스 입문 집중 클래스",
    "4 / 6명",
    "모집 중",
    "마감",
    "처리할 예약",
    "최근 리뷰",
    "읽지 않은 알림",
    "빠른 실행",
  ]) {
    assert.ok(html.includes(text), `missing visible text: ${text}`)
  }
  assert.deepEqual(readHrefs(html), [
    "/coach/reservations?status=pending_payment",
    "/coach/reservations?status=confirmed",
    "/coach/lessons/new",
    "/coach/lessons",
    "/coach/reservations",
    "/coach/settlements",
    "/coach/settlements",
  ])
  assert.doesNotMatch(html, /reviewer-private-name|private-notification-payload|author|rawPayload/u)
  assert.match(html, /sm:grid-cols-2/u)
  assert.match(html, /lg:grid-cols-4/u)
  assert.match(html, /min-w-0/u)
  assert.match(html, /break-words/u)

  console.log(
    `DASHBOARD_POPULATED_HTML ${JSON.stringify({
      dimensions: { desktop: 1280, mobile: 390, tablet: 768 },
      headings: readHeadings(html),
      htmlSha256: createHash("sha256").update(html).digest("hex"),
      links: readHrefs(html),
      textAssertions: { anonymous: true, noRawPayload: true, noReviewer: true },
    })}`,
  )
})

test("renders section-specific empty states without mutating input", async () => {
  const { default: CoachDashboardPage } = await loadRequiredModule("app/coach/dashboard/page.tsx")
  resetRuntime(emptyDashboard)
  const before = JSON.stringify(emptyDashboard)

  const html = renderToStaticMarkup(await CoachDashboardPage({ searchParams: Promise.resolve({}) }))

  for (const text of [
    "오늘 예정된 일정이 없습니다.",
    "처리할 예약이 없습니다.",
    "정산 예정 내역이 없습니다.",
    "아직 등록된 리뷰가 없습니다.",
    "읽지 않은 알림이 없습니다.",
  ]) {
    assert.ok(html.includes(text), `missing empty state: ${text}`)
  }
  assert.equal(JSON.stringify(emptyDashboard), before)
})
