import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import test from "node:test"

const apiDoc = await readFile("SPOLINK_API_명세서.md", "utf8")
const screenDoc = await readFile("SPOLINK_화면_설계.md", "utf8")
const designDoc = await readFile("SPOLINK_디자인_시스템.md", "utf8")
const policyDoc = await readFile("SPOLINK_서비스_정책서.md", "utf8")
const erdDoc = await readFile("SPOLINK_ERD.md", "utf8")

const routeContracts = [
  "/api/lessons/{lessonId}/schedules/{scheduleId}",
  "/api/lessons/{lessonId}/schedules/{scheduleId}/close",
  "/api/lessons/{lessonId}/status",
  "/api/favorites",
  "/api/reservations/{reservationId}/complete",
  "/api/reservations/{reservationId}/no-show",
  "/api/reviews",
  "/api/admin/reviews/{reviewId}/hide",
  "/api/reports",
  "/api/admin/reports",
  "/api/admin/reports/{reportId}/resolve",
  "/api/blocks",
  "/api/notifications",
  "/api/notifications/{notificationId}/read",
  "/api/refunds/{refundId}/claim",
  "/api/refunds/{refundId}/process",
  "/api/settlements",
  "/api/settlements/generate",
  "/api/settlements/generate/{reservationId}",
  "/api/settlements/{settlementId}/approve",
  "/api/settlements/{settlementId}/hold",
  "/api/admin/reservations",
  "/api/admin/reservations/{reservationId}",
  "/api/admin/reservations/{reservationId}/status",
]

const sqlCoverage = {
  "20260814020000_add_lesson_authoring_lifecycle.sql":
    "tests/lesson-authoring-sql-contract.test.mjs",
  "20260814030000_add_favorite_mutations.sql": "tests/favorites-mutation-contract.test.mjs",
  "20260814100000_add_trust_safety_workflows.sql": "tests/trust-safety.test.mjs",
  "20260814120000_add_reservation_lifecycle.sql": "tests/reservation-lifecycle-contract.test.mjs",
  "20260814130000_add_review_lifecycle.sql": "tests/reviews.test.mjs",
  "20260814140000_add_notification_events.sql": "tests/notifications.test.mjs",
  "20260814170000_add_refund_reconciliation_and_settlements.sql":
    "tests/money-operations-contract.test.mjs",
}

const browserCoverage = {
  "app/coach/lessons": "tests/auth-ui-e2e/task-10-ui.spec.ts",
  "app/coach/reservations": "tests/auth-ui-e2e/task-10-ui.spec.ts",
  "app/coach/settlements": "tests/auth-ui-e2e/task-10-ui.spec.ts",
  "app/mypage/favorites": "tests/auth-ui-e2e/favorites.spec.ts",
  "app/mypage/reviews": "tests/auth-ui-e2e/reviews.spec.ts",
  "app/mypage/trust-safety": "tests/auth-ui-e2e/trust-safety.spec.ts",
  "app/mypage/notifications": "tests/auth-ui-e2e/task-10-ui.spec.ts",
  "app/admin/reports": "tests/auth-ui-e2e/task-10-ui.spec.ts",
  "app/admin/reservations": "tests/auth-ui-e2e/task-10-ui.spec.ts",
  "app/admin/settlements": "tests/auth-ui-e2e/task-10-ui.spec.ts",
}

test("every high-priority route is named in the API contract", () => {
  for (const route of routeContracts)
    assert.match(apiDoc, new RegExp(escapeRegExp(route), "u"), route)
})

test("every high-priority state boundary is represented in all product contracts", () => {
  for (const marker of [
    "completed",
    "no_show_user",
    "no_show_coach",
    "lesson_favorites",
    "settlement_status",
    "notification_type",
    "message",
    "actual Toss refund execution",
    "payout network",
  ]) {
    assert.match(
      `${apiDoc}\n${screenDoc}\n${designDoc}\n${policyDoc}\n${erdDoc}`,
      new RegExp(escapeRegExp(marker), "iu"),
      marker,
    )
  }
})

test("each new SQL migration has a focused SQL contract and each new UI surface has browser coverage", async () => {
  for (const [migration, contract] of Object.entries(sqlCoverage)) {
    await access(`supabase/migrations/${migration}`)
    await access(contract)
  }
  for (const [surface, spec] of Object.entries(browserCoverage)) {
    await access(surface)
    await access(spec)
  }
})

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}
