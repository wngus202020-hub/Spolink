import assert from "node:assert/strict"

import { reservationId } from "./payment-prepare-sql-test-fixtures.mjs"

export async function setAuthenticatedUser(db, userId) {
  await db.exec(`set request.jwt.claim.sub = '${userId}';`)
}

export async function createReadyPayment(db, id) {
  const result = await db.query("select * from public.create_ready_payment($1)", [id])

  assert.equal(result.rows.length, 1)

  return result.rows[0]
}

export async function assertPaymentRpcError(db, code) {
  await assert.rejects(
    () => createReadyPayment(db, reservationId),
    (error) => error.code === code,
  )
}
