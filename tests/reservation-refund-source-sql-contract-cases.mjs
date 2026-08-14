import assert from "node:assert/strict"
import {
  createRefundTestDatabase,
  insertRefund,
  selectRefundSources,
} from "./reservation-cancel-sql-test-helpers.mjs"

export async function manualRefundSourceDefaultBehavior() {
  const db = await createRefundTestDatabase()

  try {
    // Given: a refund row without an explicit source.
    await insertRefund(db)

    // When: the persisted source is read.
    const sources = await selectRefundSources(db)

    // Then: the schema supplies the manual source default.
    assert.deepEqual(sources, [{ count: 1, source: "manual" }])
  } finally {
    await db.close()
  }
}

export async function malformedRefundSourceBehavior() {
  const db = await createRefundTestDatabase()

  try {
    // Given: an unsupported refund source.
    // When: the source crosses the database boundary.
    let malformedSourceCode = null
    try {
      await insertRefund(db, "provider_webhook")
    } catch (error) {
      malformedSourceCode = error.code
    }

    // Then: the check constraint rejects it with PostgreSQL's check-violation code.
    assert.equal(malformedSourceCode, "23514")
  } finally {
    await db.close()
  }
}

export async function automaticRefundUniquenessBehavior() {
  const db = await createRefundTestDatabase()

  try {
    // Given: two manual refunds and both automatic refund identities.
    await insertRefund(db, "manual")
    await insertRefund(db, "manual")
    await insertRefund(db, "reservation_cancellation")
    await insertRefund(db, "payment_confirmation_reconciliation")

    // When: the same cancellation source is inserted again.
    let duplicateCode = null
    try {
      await insertRefund(db, "reservation_cancellation")
    } catch (error) {
      duplicateCode = error.code
    }

    // Then: coexistence remains intact and only the duplicate automatic source is denied.
    const sources = await selectRefundSources(db)
    assert.equal(duplicateCode, "23505")
    assert.deepEqual(sources, [
      { count: 2, source: "manual" },
      { count: 1, source: "payment_confirmation_reconciliation" },
      { count: 1, source: "reservation_cancellation" },
    ])
  } finally {
    await db.close()
  }
}
