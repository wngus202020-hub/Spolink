import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { fixedIds } from "./fixtures.mjs"
import { assertMetadata } from "./task8/qa-assertions.mjs"
import { assertQaSnapshot } from "./task8/qa-db.mjs"

const authIds = {
  coach: "00000000-0000-4000-8000-000000000102",
  learner: "00000000-0000-4000-8000-000000000101",
}

test("cancelled QA snapshot rejects side-effect mutations", () => {
  const body = cancellationBody()
  const valid = cancelledSnapshot(body)
  assertQaSnapshot(valid, authIds, "cancelled", body, "QA authenticated")

  for (const [label, mutate] of [
    ["refund source", (state) => (state.refunds[0].source = "manual")],
    ["notification recipient", (state) => (state.notifications[0].user_id = authIds.learner)],
    ["notification type", (state) => (state.notifications[0].type = "reservation_confirmed")],
    ["notification status", (state) => (state.notifications[0].status = "confirmed")],
    ["audit action", (state) => (state.audits[0].action = "reservation.updated")],
  ]) {
    const mutated = structuredClone(valid)
    mutate(mutated)
    assert.throws(
      () => assertQaSnapshot(mutated, authIds, "cancelled", body, "QA authenticated"),
      undefined,
      label,
    )
  }
})

test("QA metadata rejects malformed or mixed-persona cookie jars", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "spolink-task8-corrective."))
  try {
    for (const [label, cookieText] of [
      ["header", "# wrong header\n127.0.0.1\tFALSE\t/\tFALSE\t0\tsb-local-auth-token\tvalue\n"],
      ["domain", netscapeRow({ domain: "localhost" })],
      ["path", netscapeRow({ cookiePath: "/admin" })],
      ["extra cookie", `${netscapeRow()}127.0.0.1\tFALSE\t/\tFALSE\t0\tpersona\tvalue\n`],
    ]) {
      const fixture = await writeQaFixture(root, label.replaceAll(" ", "-"), cookieText)
      await assert.rejects(() => assertMetadata(fixture, process.cwd()), undefined, label)
    }
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("QA metadata path itself must be absolute and outside the repository", async () => {
  const metadataPath = path.join(process.cwd(), `.task8-inside-${process.pid}.json`)
  const cookieJarPath = path.join(os.tmpdir(), `.task8-cookie-${process.pid}.txt`)
  const releasePath = path.join(os.tmpdir(), `.task8-release-${process.pid}.json`)
  try {
    await writeFile(cookieJarPath, netscapeRow(), { mode: 0o600 })
    await writeFile(releasePath, '{"released":false}\n', { mode: 0o600 })
    await writeFile(
      metadataPath,
      JSON.stringify({
        baseUrl: "http://127.0.0.1:3006",
        cookieJarPath,
        releasePath,
        reservationId: fixedIds.cancellableReservation,
      }),
      { mode: 0o600 },
    )
    await assert.rejects(() => assertMetadata(metadataPath, process.cwd()), /outside/)
    await assert.rejects(
      () => assertMetadata(path.relative(process.cwd(), metadataPath)),
      /absolute/,
    )
  } finally {
    await rm(metadataPath, { force: true })
    await rm(cookieJarPath, { force: true })
    await rm(releasePath, { force: true })
  }
})

async function writeQaFixture(root, name, cookieText) {
  const directory = path.join(root, name)
  const metadataPath = path.join(directory, "metadata.json")
  const cookieJarPath = path.join(directory, "cookies.txt")
  const releasePath = path.join(directory, "release.json")
  await import("node:fs/promises").then((fs) => fs.mkdir(directory))
  await writeFile(cookieJarPath, cookieText, { mode: 0o600 })
  await writeFile(releasePath, '{"released":false}\n', { mode: 0o600 })
  await writeFile(
    metadataPath,
    JSON.stringify({
      baseUrl: "http://127.0.0.1:3006",
      cookieJarPath,
      releasePath,
      reservationId: fixedIds.cancellableReservation,
    }),
    { mode: 0o600 },
  )
  return metadataPath
}

function netscapeRow({ domain = "127.0.0.1", cookiePath = "/" } = {}) {
  return `# Netscape HTTP Cookie File\n${domain}\tFALSE\t${cookiePath}\tFALSE\t0\tsb-local-auth-token\tvalue\n`
}

function cancellationBody() {
  return {
    data: {
      cancelledAt: "2026-07-17T12:00:00.000Z",
      refund: { amount: 7000, id: "00000000-0000-4000-8000-000000000701", status: "requested" },
      reservationId: fixedIds.cancellableReservation,
      status: "cancelled_by_user",
    },
  }
}

function cancelledSnapshot(body) {
  return {
    audits: [
      {
        action: "reservation.cancelled",
        actor_id: authIds.learner,
        after_data: {
          actorType: "learner",
          reason: "QA authenticated",
          refundAmount: 7000,
          refundId: body.data.refund.id,
          status: "cancelled_by_user",
        },
        before_data: { paymentStatus: "paid", status: "confirmed" },
        target_id: fixedIds.cancellableReservation,
        target_type: "reservation",
      },
    ],
    notifications: [
      { status: "cancelled_by_user", type: "reservation_cancelled", user_id: authIds.coach },
    ],
    payment: {
      amount: 10001,
      approved_at: "2026-07-17T11:00:00.000Z",
      failed_reason: null,
      id: fixedIds.cancellablePayment,
      payer_id: authIds.learner,
      provider: "toss",
      provider_order_id: `spolink_${fixedIds.cancellableReservation}`,
      provider_payment_key: "local-seed-402",
      raw_payload: {
        orderId: `spolink_${fixedIds.cancellableReservation}`,
        paymentKey: "local-seed-402",
        status: "DONE",
        totalAmount: 10001,
      },
      reservation_id: fixedIds.cancellableReservation,
      status: "paid",
    },
    refunds: [
      {
        amount: 7000,
        id: body.data.refund.id,
        payment_id: fixedIds.cancellablePayment,
        processed_at: null,
        provider_refund_key: null,
        raw_payload: null,
        reason: "QA authenticated",
        requested_by: authIds.learner,
        reservation_id: fixedIds.cancellableReservation,
        source: "reservation_cancellation",
        status: "requested",
      },
    ],
    reservation: {
      cancellation_reason: "QA authenticated",
      cancelled_at: body.data.cancelledAt,
      coach_profile_id: fixedIds.approvedCoachProfile,
      completed_at: null,
      confirmed_at: "2026-07-17T11:00:00.000Z",
      dispute_reason: null,
      id: fixedIds.cancellableReservation,
      learner_id: authIds.learner,
      lesson_id: fixedIds.lesson,
      lesson_schedule_id: fixedIds.baselineOpenSchedule,
      no_show_marked_at: null,
      payment_expires_at: null,
      reserved_price_amount: 10001,
      status: "cancelled_by_user",
    },
    schedule: {
      capacity: 2,
      ends_at: "2099-01-01T02:00:00.000Z",
      id: fixedIds.baselineOpenSchedule,
      is_open: true,
      lesson_id: fixedIds.lesson,
      reserved_count: 0,
      starts_at: "2099-01-01T01:00:00.000Z",
    },
  }
}
