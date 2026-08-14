import assert from "node:assert/strict"
import test from "node:test"
import {
  extractRowLockSequence,
  readPaymentFunction,
} from "./payment-lock-order-sql-test-helpers.mjs"
import {
  cancelReservation,
  confirmThenCancel,
  createCancellationTestDatabase,
  ids,
  seedCancellationScenario,
  setAnonymousUser,
  setAuthenticatedUser,
} from "./reservation-cancel-sql-fixtures.mjs"
import {
  cancellationSnapshot,
  expectSqlState,
  readCancellationState,
  readNotificationRecipients,
} from "./reservation-cancel-sql-observables.mjs"
import {
  automaticRefundUniquenessBehavior,
  malformedRefundSourceBehavior,
  manualRefundSourceDefaultBehavior,
} from "./reservation-refund-source-sql-contract-cases.mjs"

test("refund source defaults to manual", manualRefundSourceDefaultBehavior)
test("refund source rejects malformed input", malformedRefundSourceBehavior)
test(
  "automatic refund uniqueness allows distinct automatic sources and manual refunds",
  automaticRefundUniquenessBehavior,
)

test("cancel_reservation locks reservation before payment and schedule", async () => {
  const functionSql = await readPaymentFunction("cancel_reservation")
  assert.deepEqual(extractRowLockSequence(functionSql), [
    "reservations",
    "payments",
    "lesson_schedules",
  ])
})

test("cancel_reservation cancels a confirmed learner reservation atomically", async () => {
  const db = await createCancellationTestDatabase()

  try {
    // Given: the authenticated learner owns a paid confirmed reservation exactly 24 hours out.
    await seedCancellationScenario(db)
    await setAuthenticatedUser(db, ids.learner)

    // When: the learner calls the database cancellation boundary.
    const cancellation = await cancelReservation(db, "Schedule changed", { remaining: "24 hours" })

    // Then: the typed RPC result reports the learner cancellation and policy refund.
    assert.equal(cancellation.reservation_status, "cancelled_by_user")
    assert.equal(cancellation.refund_amount, 7000)
    const state = await readCancellationState(db)
    assert.equal(state.requested_by, ids.learner)
    assert.equal(state.refund_source, "reservation_cancellation")
    assert.equal(state.refund_status, "requested")
    assert.equal(state.reserved_count, 0)
    assert.equal(state.payment_status, "paid")
    assert.equal(state.notification_count, 1)
    assert.equal(state.audit_count, 1)
  } finally {
    await db.close()
  }
})

for (const [remaining, amount] of [
  ["24 hours", 7000],
  ["23 hours 59 minutes 59 seconds", 5000],
  ["3 hours", 5000],
  ["2 hours 59 minutes 59 seconds", null],
]) {
  test(`cancel_reservation learner refund at ${remaining} is ${amount ?? 0}`, async () => {
    const db = await createCancellationTestDatabase()
    try {
      // Given: a paid learner reservation at an exact policy boundary.
      await seedCancellationScenario(db)
      await setAuthenticatedUser(db, ids.learner)

      // When: cancellation occurs at the transaction-pinned remaining time.
      const result = await cancelReservation(db, "Boundary", { remaining })

      // Then: gross 10,001 won is floored to the contracted refund amount.
      assert.equal(result.refund_amount, amount)
    } finally {
      await db.close()
    }
  })
}

for (const [actor, status, recipients] of [
  [ids.coachUser, "cancelled_by_coach", [ids.learner]],
  [ids.admin, "cancelled_by_admin", [ids.learner, ids.coachUser]],
]) {
  test(`cancel_reservation gives ${status} a full refund`, async () => {
    const db = await createCancellationTestDatabase()
    try {
      // Given: an authorized non-learner actor and a confirmed reservation.
      await seedCancellationScenario(db)
      await setAuthenticatedUser(db, actor)

      // When: the actor cancels.
      const result = await cancelReservation(db, "Authorized cancellation")

      // Then: result, requester, and recipients reflect that actor.
      assert.equal(result.reservation_status, status)
      assert.equal(result.refund_amount, 10001)
      assert.equal((await readCancellationState(db)).requested_by, actor)
      assert.deepEqual(await readNotificationRecipients(db), recipients.sort())
    } finally {
      await db.close()
    }
  })
}

test("cancel_reservation pending payment supports learner and admin without refund or capacity delta", async () => {
  for (const [actor, status] of [
    [ids.learner, "cancelled_by_user"],
    [ids.admin, "cancelled_by_admin"],
  ]) {
    const db = await createCancellationTestDatabase()
    try {
      // Given: an authorized actor and a ready pending-payment reservation.
      await seedCancellationScenario(db, {
        paymentStatus: "ready",
        reservationStatus: "pending_payment",
      })
      await setAuthenticatedUser(db, actor)

      // When: the pending reservation is cancelled.
      const result = await cancelReservation(db, "Pending cancellation")

      // Then: payment and expiration clear without refund or count mutation.
      const state = await readCancellationState(db)
      assert.equal(result.reservation_status, status)
      assert.equal(result.refund_id, null)
      assert.equal(state.payment_status, "cancelled")
      assert.equal(state.payment_expires_at, null)
      assert.equal(state.reserved_count, 0)
    } finally {
      await db.close()
    }
  }
})

for (const scenario of [
  { name: "unrelated learner", actor: ids.otherLearner },
  { name: "suspended learner", actor: ids.learner, options: { learnerStatus: "suspended" } },
  {
    name: "deleted learner",
    actor: ids.learner,
    options: { learnerStatus: "deleted", learnerDeletedAt: "now()" },
  },
  { name: "coach pending", actor: ids.coachUser, options: { coachStatus: "submitted" } },
]) {
  test(`cancel_reservation rejects ${scenario.name} with rollback`, async () => {
    const db = await createCancellationTestDatabase()
    try {
      // Given: an actor who must not cross the cancellation boundary.
      await seedCancellationScenario(db, scenario.options)
      await setAuthenticatedUser(db, scenario.actor)
      const before = cancellationSnapshot(await readCancellationState(db))

      // When: the unauthorized actor attempts cancellation.
      await expectSqlState(() => cancelReservation(db), "42501")

      // Then: every transactional side effect remains unchanged.
      assert.deepEqual(cancellationSnapshot(await readCancellationState(db)), before)
    } finally {
      await db.close()
    }
  })
}

test("cancel_reservation rejects coach pending-payment and unsupported payment state", async () => {
  for (const options of [
    { actor: ids.coachUser, paymentStatus: "ready", reservationStatus: "pending_payment" },
    { actor: ids.learner, paymentStatus: "ready", reservationStatus: "confirmed" },
    { actor: ids.learner, paymentStatus: "paid", reservationStatus: "completed" },
  ]) {
    const db = await createCancellationTestDatabase()
    try {
      // Given: an authorized relationship with an unsupported reservation/payment pair.
      await seedCancellationScenario(db, options)
      await setAuthenticatedUser(db, options.actor)
      const before = cancellationSnapshot(await readCancellationState(db))

      // When: cancellation is attempted.
      await expectSqlState(() => cancelReservation(db), "P0001")

      // Then: the rejected transaction changes nothing.
      assert.deepEqual(cancellationSnapshot(await readCancellationState(db)), before)
    } finally {
      await db.close()
    }
  }
})

test("cancel_reservation rejects invalid reason and missing reservation", async () => {
  const db = await createCancellationTestDatabase()
  try {
    // Given: an authenticated owner with a valid confirmed reservation.
    await seedCancellationScenario(db)
    await setAuthenticatedUser(db, ids.learner)

    // When/Then: malformed reasons and a missing identifier expose stable SQLSTATEs.
    await expectSqlState(() => cancelReservation(db, "   "), "22023")
    await expectSqlState(() => cancelReservation(db, "x".repeat(201)), "22023")
    await expectSqlState(
      () =>
        cancelReservation(db, "Valid", { reservationId: "00000000-0000-4000-8000-000000000999" }),
      "P0002",
    )
  } finally {
    await db.close()
  }
})

test("cancel_reservation execute is authenticated only", async () => {
  const db = await createCancellationTestDatabase()
  try {
    // Given: a valid reservation but an anonymous database role.
    await seedCancellationScenario(db)
    await setAnonymousUser(db)

    // When/Then: PostgreSQL denies execution before actor derivation.
    await expectSqlState(() => cancelReservation(db), "42501")
  } finally {
    await db.close()
  }
})

test("cancel_reservation exact repeat is idempotent and conflicting repeat is rejected", async () => {
  const db = await createCancellationTestDatabase()
  try {
    // Given: a successful cancellation with a trimmed reason identity.
    await seedCancellationScenario(db)
    await setAuthenticatedUser(db, ids.learner)
    const first = await cancelReservation(db, "  Same reason  ")
    const firstState = await readCancellationState(db)

    // When: the exact request repeats, followed by a conflicting reason.
    const repeated = await cancelReservation(db, "Same reason")
    await expectSqlState(() => cancelReservation(db, "Different reason"), "23505")

    // Then: the original result and single side-effect set are preserved.
    assert.deepEqual(repeated, first)
    assert.deepEqual(await readCancellationState(db), firstState)
  } finally {
    await db.close()
  }
})

test("cancel_reservation direct reserved count update is denied but RPC decrement succeeds", async () => {
  const db = await createCancellationTestDatabase()
  try {
    // Given: an authenticated learner and reserved confirmed capacity.
    await seedCancellationScenario(db)
    await setAuthenticatedUser(db, ids.learner)

    // When: direct mutation is attempted before the owner RPC.
    await expectSqlState(
      () =>
        db.exec(
          `update public.lesson_schedules set reserved_count = 0 where id = '${ids.schedule}'`,
        ),
      "42501",
    )
    const result = await cancelReservation(db)

    // Then: only the security-definer RPC decrements capacity.
    assert.equal(result.reservation_status, "cancelled_by_user")
    assert.equal((await readCancellationState(db)).reserved_count, 0)
  } finally {
    await db.close()
  }
})

test("cancel_reservation after confirmation creates normal refund and releases capacity", async () => {
  const db = await createCancellationTestDatabase()
  try {
    // Given: a pending ready payment with no reserved capacity.
    await seedCancellationScenario(db, {
      paymentStatus: "ready",
      reservationStatus: "pending_payment",
    })

    // When: the real confirmation RPC runs before learner cancellation.
    const result = await confirmThenCancel(db)

    // Then: cancellation follows the normal 70% policy and returns capacity to zero.
    assert.equal(result.refund_amount, 7000)
    assert.equal((await readCancellationState(db)).reserved_count, 0)
  } finally {
    await db.close()
  }
})
