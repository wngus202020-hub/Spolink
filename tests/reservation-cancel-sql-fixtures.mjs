import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import { PGlite } from "@electric-sql/pglite"

const migrationPath = new URL(
  "../supabase/migrations/20260712000000_mvp_schema.sql",
  import.meta.url,
)

export const ids = {
  admin: "00000000-0000-4000-8000-000000000003",
  coachProfile: "00000000-0000-4000-8000-000000000201",
  coachUser: "00000000-0000-4000-8000-000000000004",
  learner: "00000000-0000-4000-8000-000000000001",
  lesson: "00000000-0000-4000-8000-000000000101",
  otherLearner: "00000000-0000-4000-8000-000000000002",
  payment: "00000000-0000-4000-8000-000000000501",
  reservation: "00000000-0000-4000-8000-000000000401",
  schedule: "00000000-0000-4000-8000-000000000301",
}

export async function createCancellationTestDatabase() {
  const db = new PGlite()
  const migration = await readFile(migrationPath, "utf8")

  await db.exec(databasePrelude)
  await loadMigrationFunction(
    db,
    migration,
    "public.current_user_role",
    "create or replace function public.is_admin",
  )
  await loadMigrationFunction(
    db,
    migration,
    "public.is_admin",
    "create or replace function public.owns_coach_profile",
  )
  await loadMigrationFunction(
    db,
    migration,
    "public.protect_schedule_reserved_count",
    "create or replace function public.protect_notification_read_update",
  )
  await loadMigrationFunction(
    db,
    migration,
    "public.calculate_cancellation_refund",
    "revoke all on function public.calculate_cancellation_refund",
    false,
  )
  await loadMigrationFunction(
    db,
    migration,
    "public.cancel_reservation",
    "revoke all on function public.cancel_reservation",
    false,
  )
  await loadFunctionAcl(db, migration, "public.calculate_cancellation_refund", false)
  await loadFunctionAcl(db, migration, "public.cancel_reservation", false)
  await loadMigrationFunction(
    db,
    migration,
    "public.confirm_paid_reservation",
    "revoke all on function public.confirm_paid_reservation",
  )
  await db.exec(`
    create trigger lesson_schedules_protect_reserved_count before update on public.lesson_schedules
      for each row execute function public.protect_schedule_reserved_count();
    grant usage on schema public, auth to authenticated;
    grant execute on function auth.uid(), auth.role() to authenticated;
    grant select, update on public.lesson_schedules to authenticated;
    grant execute on function public.confirm_paid_reservation(uuid, text, text, integer, jsonb) to service_role;
  `)

  return db
}

export async function seedCancellationScenario(db, options = {}) {
  const learnerRole = options.learnerRole ?? "learner"
  const learnerStatus = options.learnerStatus ?? "active"
  const learnerDeletedAt = options.learnerDeletedAt ?? "null"
  const coachStatus = options.coachStatus ?? "approved"
  const coachUserStatus = options.coachUserStatus ?? "coach_approved"
  const paymentStatus = options.paymentStatus ?? "paid"
  const reservationStatus = options.reservationStatus ?? "confirmed"
  const startsAt = options.startsAt ?? "now() + interval '24 hours'"
  const reservedCount = reservationStatus === "confirmed" ? 1 : 0

  await db.exec(`
    insert into public.profiles (id, role, status, display_name, deleted_at) values
      ('${ids.learner}', '${learnerRole}', '${learnerStatus}', 'Learner', ${learnerDeletedAt}),
      ('${ids.otherLearner}', 'learner', 'active', 'Other learner', null),
      ('${ids.coachUser}', 'coach', '${coachUserStatus}', 'Coach', null),
      ('${ids.admin}', 'admin', 'active', 'Admin', null);
    insert into public.coach_profiles (id, user_id, status)
      values ('${ids.coachProfile}', '${ids.coachUser}', '${coachStatus}');
    insert into public.lesson_schedules (id, lesson_id, starts_at, capacity, reserved_count)
      values ('${ids.schedule}', '${ids.lesson}', ${startsAt}, 2, ${reservedCount});
    insert into public.reservations (
      id, lesson_id, lesson_schedule_id, learner_id, coach_profile_id, status,
      reserved_price_amount, payment_expires_at, confirmed_at
    ) values (
      '${ids.reservation}', '${ids.lesson}', '${ids.schedule}', '${ids.learner}',
      '${ids.coachProfile}', '${reservationStatus}', 10001,
      ${reservationStatus === "pending_payment" ? "now() + interval '10 minutes'" : "null"},
      ${reservationStatus === "confirmed" ? "now()" : "null"}
    );
    insert into public.payments (
      id, reservation_id, payer_id, status, provider_order_id, amount, approved_at
    ) values (
      '${ids.payment}', '${ids.reservation}', '${ids.learner}', '${paymentStatus}',
      'spolink_${ids.reservation}', 10001,
      ${paymentStatus === "paid" ? "now()" : "null"}
    );
  `)
}

export async function setAuthenticatedUser(db, userId) {
  await db.exec(`
    reset role;
    set request.jwt.claim.sub = '${userId}';
    set request.jwt.claim.role = 'authenticated';
    set role authenticated;
  `)
}

export async function setAnonymousUser(db) {
  await db.exec(`
    reset role;
    set request.jwt.claim.sub = '';
    set request.jwt.claim.role = 'anon';
    set role anon;
  `)
}

export async function cancelReservation(db, reason = "Schedule changed", options = {}) {
  const reservationId = options.reservationId ?? ids.reservation
  await db.exec("begin")
  try {
    if (options.remaining !== undefined) {
      await db.exec(`
        reset role;
        update public.lesson_schedules
          set starts_at = transaction_timestamp() + interval '${options.remaining}'
          where id = '${ids.schedule}';
        set role authenticated;
      `)
    }
    const result = await db.query("select * from public.cancel_reservation($1, $2)", [
      reservationId,
      reason,
    ])
    await db.exec("commit")

    assert.equal(result.rows.length, 1)
    return result.rows[0]
  } catch (error) {
    await db.exec("rollback")
    throw error
  }
}

export async function confirmThenCancel(db, reason = "Schedule changed") {
  await db.exec(`
    reset role;
    set request.jwt.claim.role = 'service_role';
    set role service_role;
  `)
  await db.query("select * from public.confirm_paid_reservation($1, $2, $3, $4, $5)", [
    ids.reservation,
    `spolink_${ids.reservation}`,
    "confirmed-provider-key",
    10001,
    {
      orderId: `spolink_${ids.reservation}`,
      paymentKey: "confirmed-provider-key",
      status: "DONE",
      totalAmount: 10001,
    },
  ])
  await setAuthenticatedUser(db, ids.learner)
  return cancelReservation(db, reason, { remaining: "24 hours" })
}

async function loadMigrationFunction(db, sql, name, endMarker, required = true) {
  const start = sql.indexOf(`create or replace function ${name}`)
  const end = sql.indexOf(endMarker, start)

  if (!required && start === -1) return
  assert.notEqual(start, -1, `${name} must exist`)
  assert.notEqual(end, -1, `${name} must have an end marker`)
  await db.exec(sql.slice(start, end))
}

async function loadFunctionAcl(db, sql, name, required = true) {
  const start = sql.indexOf(`revoke all on function ${name}`)
  const firstEnd = sql.indexOf(";", start)
  const secondEnd = sql.indexOf(";", firstEnd + 1)

  if (!required && start === -1) return
  assert.notEqual(start, -1, `${name} ACL must exist`)
  const end = name === "public.cancel_reservation" ? secondEnd : firstEnd
  assert.notEqual(end, -1, `${name} ACL must include grant/revoke statements`)
  await db.exec(sql.slice(start, end + 1))
}

const databasePrelude = `
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create type public.user_role as enum ('learner', 'coach', 'admin');
  create type public.user_status as enum ('active', 'pending_coach', 'coach_approved', 'suspended', 'deleted');
  create type public.coach_status as enum ('draft', 'submitted', 'approved', 'rejected', 'suspended');
  create type public.reservation_status as enum ('pending_payment', 'confirmed', 'cancelled_by_user', 'cancelled_by_coach', 'cancelled_by_admin', 'completed', 'no_show_user', 'no_show_coach', 'disputed');
  create type public.payment_status as enum ('ready', 'paid', 'failed', 'cancelled', 'partially_refunded', 'refunded');
  create type public.refund_status as enum ('requested', 'approved', 'failed', 'completed');
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create function auth.role() returns text language sql stable as $$
    select nullif(current_setting('request.jwt.claim.role', true), '')
  $$;
  create table public.profiles (id uuid primary key, role public.user_role not null, status public.user_status not null, display_name text not null, deleted_at timestamptz);
  create table public.coach_profiles (id uuid primary key, user_id uuid not null unique, status public.coach_status not null);
  create table public.lesson_schedules (id uuid primary key, lesson_id uuid not null, starts_at timestamptz not null, capacity integer not null, reserved_count integer not null default 0, updated_at timestamptz not null default now());
  create table public.reservations (id uuid primary key, lesson_id uuid not null, lesson_schedule_id uuid not null, learner_id uuid not null, coach_profile_id uuid not null, status public.reservation_status not null, reserved_price_amount integer not null, payment_expires_at timestamptz, confirmed_at timestamptz, cancelled_at timestamptz, cancellation_reason text, updated_at timestamptz not null default now());
  create table public.payments (id uuid primary key, reservation_id uuid not null unique, payer_id uuid not null, status public.payment_status not null, provider text not null default 'toss', provider_payment_key text unique, provider_order_id text not null unique, amount integer not null, approved_at timestamptz, failed_reason text, raw_payload jsonb, updated_at timestamptz not null default now());
  create table public.refunds (id uuid primary key default gen_random_uuid(), payment_id uuid not null, reservation_id uuid not null, requested_by uuid not null, amount integer not null, reason text not null, source text not null default 'manual', provider_refund_key text, status public.refund_status not null default 'requested', processed_at timestamptz, raw_payload jsonb, created_at timestamptz not null default now());
  create unique index refunds_automatic_reservation_source_unique on public.refunds (reservation_id, source) where source in ('reservation_cancellation', 'payment_confirmation_reconciliation');
  create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null, type text not null, title text not null, body text, data jsonb, created_at timestamptz not null default now());
  create table public.audit_logs (id uuid primary key default gen_random_uuid(), actor_id uuid, action text not null, target_type text not null, target_id uuid not null, before_data jsonb, after_data jsonb, created_at timestamptz not null default now());
`
