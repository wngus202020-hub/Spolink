import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import { PGlite } from "@electric-sql/pglite"

const migrationPath = new URL(
  "../supabase/migrations/20260712000000_mvp_schema.sql",
  import.meta.url,
)

export const learnerId = "00000000-0000-4000-8000-000000000001"
export const reservationId = "00000000-0000-4000-8000-000000000401"
export const paymentId = "00000000-0000-4000-8000-000000000501"

export async function createRefundTestDatabase() {
  const db = new PGlite()
  const migration = await readFile(migrationPath, "utf8")

  await db.exec(`
    create type public.refund_status as enum ('requested', 'approved', 'failed', 'completed');
    create table public.profiles (id uuid primary key);
    create table public.reservations (id uuid primary key);
    create table public.payments (id uuid primary key);
  `)
  await db.exec(extractStatement(migration, "create table public.refunds"))

  for (const statement of migration.matchAll(/create (?:unique )?index refunds_[\s\S]*?;/g)) {
    await db.exec(statement[0])
  }

  await db.query("insert into public.profiles (id) values ($1)", [learnerId])
  await db.query("insert into public.reservations (id) values ($1)", [reservationId])
  await db.query("insert into public.payments (id) values ($1)", [paymentId])

  return db
}

export async function insertRefund(db, source) {
  const columns = ["payment_id", "reservation_id", "requested_by", "amount", "reason"]
  const values = [paymentId, reservationId, learnerId, 1000, "contract test"]

  if (source !== undefined) {
    columns.push("source")
    values.push(source)
  }

  await db.query(
    `insert into public.refunds (${columns.join(", ")})
     values (${values.map((_, index) => `$${index + 1}`).join(", ")})`,
    values,
  )
}

export async function selectRefundSources(db) {
  const result = await db.query(`
    select source, count(*)::integer as count
    from public.refunds
    group by source
    order by source
  `)

  return result.rows
}

function extractStatement(sql, marker) {
  const start = sql.indexOf(marker)
  const end = sql.indexOf(";", start)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)

  return sql.slice(start, end + 1)
}
