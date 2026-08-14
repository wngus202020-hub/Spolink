import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationPath = new URL(
  "../supabase/migrations/20260712000000_mvp_schema.sql",
  import.meta.url,
)
const reservationApiPath = new URL("../lib/reservations/create-reservation-api.ts", import.meta.url)

test("reservation creation SQL keeps pending holds behind the RPC", async () => {
  const sql = await readFile(migrationPath, "utf8")
  const functionIndex = sql.indexOf("create or replace function public.create_pending_reservation")
  const grantIndex = sql.indexOf(
    "grant execute on function public.create_pending_reservation(uuid, uuid) to authenticated;",
  )

  assert.match(sql, /create or replace function public\.current_user_role/)
  assert.match(sql, /deleted_at is null/)
  assert.match(sql, /status not in \('suspended', 'deleted'\)/)
  assert.doesNotMatch(sql, /create or replace function public\.can_create_pending_reservation/)
  assert.match(sql, /create or replace function public\.create_pending_reservation/)
  assert.match(sql, /public\.current_user_role\(\) is distinct from 'learner'/)
  assert.ok(grantIndex > functionIndex)
  assert.match(sql, /for update;/)
  assert.match(sql, /confirmed_reservation_count/)
  assert.match(sql, /Confirmed reservation already exists\.' using errcode = '23505'/)
  assert.match(
    sql,
    /where learner_id = auth\.uid\(\)[\s\S]*and lesson_schedule_id = checked_schedule_id[\s\S]*and status = 'pending_payment'[\s\S]*and payment_expires_at > now\(\)[\s\S]*return created_reservation;/,
  )
  assert.match(sql, /active_pending_count/)
  assert.match(sql, /payment_expires_at > now\(\)/)
  assert.match(sql, /Schedule capacity exceeded\.' using errcode = 'P0003'/)
  assert.match(sql, /now\(\) \+ interval '10 minutes'/)
  assert.match(
    sql,
    /revoke all on function public\.create_pending_reservation\(uuid, uuid\) from public;/,
  )
  assert.match(
    sql,
    /grant execute on function public\.create_pending_reservation\(uuid, uuid\) to authenticated;/,
  )
  assert.match(sql, /create policy "reservations_insert_learner"[\s\S]*with check \(false\);/)
  assert.match(sql, /where status = 'confirmed';/)

  const confirmedDuplicateIndex = sql.indexOf(
    "if confirmed_reservation_count > 0 then",
    functionIndex,
  )
  const pendingReuseIndex = sql.indexOf("return created_reservation;", confirmedDuplicateIndex)
  const capacityCountIndex = sql.indexOf("into active_pending_count", pendingReuseIndex)
  const insertIndex = sql.indexOf("insert into public.reservations", capacityCountIndex)

  assert.ok(confirmedDuplicateIndex < pendingReuseIndex)
  assert.ok(pendingReuseIndex < capacityCountIndex)
  assert.ok(capacityCountIndex < insertIndex)
})

test("reservation workflow preserves documented conflict error codes", async () => {
  const reservationApi = await readFile(reservationApiPath, "utf8")

  assert.match(reservationApi, /errorCode === "P0003"/)
  assert.match(reservationApi, /"CAPACITY_EXCEEDED"/)
  assert.match(reservationApi, /"CONFLICT"/)
  assert.doesNotMatch(reservationApi, /"SCHEDULE_NOT_AVAILABLE"/)
})
