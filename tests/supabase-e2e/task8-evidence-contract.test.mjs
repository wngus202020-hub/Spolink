import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import { assertTask8QaProof } from "./task8/evidence-semantics.mjs"

test("Task8 evidence semantics reject HTTP, DB, and cleanup substitutions", () => {
  const fixture = validFixture()
  assertTask8QaProof(fixture)
  for (const mutate of [
    (value) => (value.summary.authenticatedCancellation.status = 401),
    (value) => (value.cancelled.snapshot.refunds[0].source = "manual"),
    (value) => (value.cancelled.snapshot.notifications[0].user_id = "learner"),
    (value) => (value.summary.cleanup.sha256 = "0".repeat(64)),
  ]) {
    const changed = structuredClone(fixture)
    mutate(changed)
    assert.throws(() => assertTask8QaProof(changed))
  }
})

function validFixture() {
  const querySha = "a".repeat(64)
  const body = {
    data: {
      cancelledAt: "2026-07-17T12:00:00.000Z",
      refund: {
        amount: 7000,
        id: "00000000-0000-4000-8000-000000000701",
        status: "requested",
      },
      reservationId: "00000000-0000-4000-8000-000000000402",
      status: "cancelled_by_user",
    },
  }
  const cancelled = {
    querySha256: querySha,
    snapshot: {
      audits: [{ action: "reservation.cancelled" }],
      notifications: [
        { status: "cancelled_by_user", type: "reservation_cancelled", user_id: "coach" },
      ],
      payment: {
        amount: 10001,
        id: "00000000-0000-4000-8000-000000000502",
        provider: "toss",
        provider_order_id: "<redacted>",
        provider_order_id_sha256: "c".repeat(64),
        provider_payment_key: "<redacted>",
        provider_payment_key_present: true,
        provider_payment_key_sha256: "d".repeat(64),
        raw_payload: {
          orderId: "<redacted>",
          orderIdSha256: "e".repeat(64),
          paymentKey: "<redacted>",
          paymentKeySha256: "f".repeat(64),
        },
        status: "paid",
      },
      refunds: [
        {
          amount: 7000,
          id: body.data.refund.id,
          source: "reservation_cancellation",
          status: "requested",
        },
      ],
      reservation: {
        cancellation_reason: "QA authenticated",
        cancelled_at: body.data.cancelledAt,
        id: "00000000-0000-4000-8000-000000000402",
        status: "cancelled_by_user",
      },
      schedule: { id: "00000000-0000-4000-8000-000000000301", reserved_count: 0 },
    },
  }
  cancelled.resultSha256 = sha(cancelled.snapshot)
  const pristine = structuredClone(cancelled)
  pristine.snapshot.reservation.status = "confirmed"
  pristine.snapshot.schedule.reserved_count = 1
  pristine.snapshot.refunds = []
  pristine.snapshot.notifications = []
  pristine.snapshot.audits = []
  pristine.resultSha256 = sha(pristine.snapshot)
  const configured = httpRecord({ configured: true, invalidKeys: [], missingKeys: [] }, 200)
  const unauthorized = httpRecord(
    {
      error: { code: "UNAUTHORIZED", details: [], message: "Authentication required." },
    },
    401,
  )
  const cancellation = { ...httpRecord(body, 200), transport: "curl -b" }
  const cleanupSha256 = "b".repeat(64)
  return {
    cancellation,
    cancelled,
    cleanupSha256,
    configured,
    pristine,
    summary: {
      authenticatedCancellation: summaryHttp(cancellation),
      cleanup: { sha256: cleanupSha256 },
      configured: summaryHttp(configured),
      db: {
        cancelled: summaryDb(cancelled),
        pristine: summaryDb(pristine),
      },
      qaCommand: "Todo8 exact QA-hold shell command",
      metadata: { externalFilesValidated: true },
      status: "SUCCESS",
      unauthenticatedCancellation: summaryHttp(unauthorized),
    },
    unauthorized,
  }
}

function httpRecord(body, status) {
  return { body, bodySha256: sha(body), status }
}

function summaryHttp(record) {
  return {
    bodySha256: record.bodySha256,
    status: record.status,
    transport: record.transport ?? null,
  }
}

function summaryDb(record) {
  return { querySha256: record.querySha256, resultSha256: record.resultSha256 }
}

function sha(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}
