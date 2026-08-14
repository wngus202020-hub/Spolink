import assert from "node:assert/strict"
import { confirmPaidReservation } from "./payment-confirm-sql-test-helpers.mjs"

export async function assertConfirmError(db, code, options = {}) {
  await assert.rejects(
    () => confirmPaidReservation(db, options),
    (error) => error.code === code,
  )
}

export async function selectOne(db, query) {
  const result = await db.query(query)

  assert.equal(result.rows.length, 1)

  return result.rows[0]
}
