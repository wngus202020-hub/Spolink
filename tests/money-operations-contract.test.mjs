import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migration = await readFile(
  "supabase/migrations/20260814170000_add_refund_reconciliation_and_settlements.sql",
  "utf8",
)
const routes = await readFile("lib/money/routes.ts", "utf8")

test("money migration owns refund totals, trusted result replay, claim state, and settlement locks", () => {
  for (const expression of [
    /protect_refund_total_invariant/u,
    /where id in \(old\.payment_id, new\.payment_id\)[\s\S]*order by id[\s\S]*for update/u,
    /select \* into selected_payment from public\.payments where id = new\.payment_id/u,
    /Refund total exceeds the original payment/u,
    /claim_refund/u,
    /selected_refund\.status in \('completed', 'failed'\)/u,
    /claim_idempotency_key/u,
    /process_refund_result/u,
    /result_fingerprint/u,
    /generate_settlement/u,
    /r\.completed_at > transaction_timestamp\(\) - interval '24 hours'/u,
    /set_settlement_status/u,
    /settlements_local_status_check/u,
    /grant execute on function public\.process_refund_result[\s\S]*service_role/u,
  ])
    assert.match(migration, expression)
  assert.doesNotMatch(
    migration,
    /update public\.settlements[\s\S]{0,240}status = '(?:paid|failed)'/u,
  )
})

test("money routes use trusted boundary and expose no provider client", () => {
  assert.match(routes, /isAuthorizedEdgeRequestHeader/u)
  assert.match(routes, /process_refund_result/u)
  assert.match(routes, /claim_refund/u)
  assert.match(routes, /generate_settlement/u)
  assert.doesNotMatch(routes, /toss-payment-verifier|fetch\(/u)
})
