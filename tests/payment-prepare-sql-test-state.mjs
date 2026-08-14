export async function readStoredPayments(db) {
  const result = await db.query(
    "select reservation_id, payer_id, status, provider, provider_order_id, amount from public.payments",
  )

  return result.rows
}

export async function readStoredPaymentCount(db) {
  const result = await db.query("select count(*)::integer as count from public.payments")

  return result.rows
}
