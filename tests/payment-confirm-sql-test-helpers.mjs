import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import { PGlite } from "@electric-sql/pglite"

const migrationPath = new URL(
  "../supabase/migrations/20260712000000_mvp_schema.sql",
  import.meta.url,
)

const learnerId = "00000000-0000-4000-8000-000000000001"
const lessonId = "00000000-0000-4000-8000-000000000101"
const coachProfileId = "00000000-0000-4000-8000-000000000201"
const scheduleId = "00000000-0000-4000-8000-000000000301"
const paymentId = "00000000-0000-4000-8000-000000000501"

export const reservationId = "00000000-0000-4000-8000-000000000401"
export const providerOrderId = `spolink_${reservationId}`
export const providerPaymentKey = "payment-key"

export async function createConfirmTestDatabase() {
  const db = new PGlite()
  const sql = await readFile(migrationPath, "utf8")

  await db.exec(`
    create schema auth;

    create type public.user_role as enum ('learner', 'coach', 'admin');
    create type public.user_status as enum ('active', 'pending_coach', 'coach_approved', 'suspended', 'deleted');
    create type public.reservation_status as enum (
      'pending_payment',
      'confirmed',
      'cancelled_by_user',
      'cancelled_by_coach',
      'cancelled_by_admin',
      'completed',
      'no_show_user',
      'no_show_coach',
      'disputed'
    );
    create type public.payment_status as enum (
      'ready',
      'paid',
      'failed',
      'cancelled',
      'partially_refunded',
      'refunded'
    );

    create table public.profiles (
      id uuid primary key,
      role public.user_role not null,
      status public.user_status not null,
      display_name text not null
    );

    create table public.lesson_schedules (
      id uuid primary key,
      lesson_id uuid not null,
      capacity integer not null,
      reserved_count integer not null default 0
    );

    create table public.reservations (
      id uuid primary key,
      lesson_id uuid not null,
      lesson_schedule_id uuid not null,
      learner_id uuid not null,
      coach_profile_id uuid not null,
      status public.reservation_status not null,
      reserved_price_amount integer not null,
      payment_expires_at timestamptz,
      confirmed_at timestamptz
    );

    create table public.payments (
      id uuid primary key,
      reservation_id uuid not null unique,
      payer_id uuid not null,
      status public.payment_status not null,
      provider text not null default 'toss',
      provider_payment_key text unique,
      provider_order_id text not null unique,
      amount integer not null,
      approved_at timestamptz,
      failed_reason text,
      raw_payload jsonb
    );

    create table public.notifications (
      id uuid primary key default '00000000-0000-4000-8000-000000000601'::uuid,
      user_id uuid not null,
      type text not null,
      title text not null,
      body text,
      data jsonb,
      read_at timestamptz,
      created_at timestamptz not null default now()
    );

    create table public.audit_logs (
      id uuid primary key default '00000000-0000-4000-8000-000000000701'::uuid,
      actor_id uuid,
      action text not null,
      target_type text not null,
      target_id uuid not null,
      before_data jsonb,
      after_data jsonb,
      created_at timestamptz not null default now()
    );

    create or replace function auth.role()
    returns text
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.role', true), '')
    $$;

    create or replace function public.is_admin()
    returns boolean
    language sql
    stable
    as $$
      select false
    $$;
  `)

  await db.exec(
    extractFunction(
      sql,
      "public.protect_schedule_reserved_count",
      "create or replace function public.protect_notification_read_update",
    ),
  )
  await db.exec(`
    create trigger lesson_schedules_protect_reserved_count before update on public.lesson_schedules
      for each row execute function public.protect_schedule_reserved_count();
  `)
  await db.exec(
    extractFunction(
      sql,
      "public.confirm_paid_reservation",
      "revoke all on function public.confirm_paid_reservation",
    ),
  )
  await db.exec(
    extractFunction(
      sql,
      "public.mark_payment_confirmation_failed",
      "revoke all on function public.mark_payment_confirmation_failed",
    ),
  )
  await db.exec(
    extractFunction(
      sql,
      "public.mark_payment_confirmation_reconciliation_required",
      "revoke all on function public.mark_payment_confirmation_reconciliation_required",
    ),
  )

  return db
}

export async function seedReadyPayment(db, options = {}) {
  const paymentExpiresAt = options.paymentExpiresAt ?? "now() + interval '10 minutes'"
  const reservedCount = options.reservedCount ?? 0

  await db.exec(`
    insert into public.profiles (id, role, status, display_name)
    values ('${learnerId}', 'learner', 'active', 'Learner');

    insert into public.lesson_schedules (id, lesson_id, capacity, reserved_count)
    values ('${scheduleId}', '${lessonId}', 1, ${reservedCount});

    insert into public.reservations (
      id,
      lesson_id,
      lesson_schedule_id,
      learner_id,
      coach_profile_id,
      status,
      reserved_price_amount,
      payment_expires_at
    )
    values (
      '${reservationId}',
      '${lessonId}',
      '${scheduleId}',
      '${learnerId}',
      '${coachProfileId}',
      'pending_payment',
      50000,
      ${paymentExpiresAt}
    );

    insert into public.payments (
      id,
      reservation_id,
      payer_id,
      status,
      provider,
      provider_order_id,
      amount
    )
    values (
      '${paymentId}',
      '${reservationId}',
      '${learnerId}',
      'ready',
      'toss',
      '${providerOrderId}',
      50000
    );
  `)
}

export async function setServiceRole(db) {
  await db.exec("set request.jwt.claim.role = 'service_role';")
}

export async function confirmPaidReservation(db, options = {}) {
  const amount = options.amount ?? 50000
  const result = await db.query(
    "select * from public.confirm_paid_reservation($1, $2, $3, $4, $5)",
    [
      reservationId,
      providerOrderId,
      providerPaymentKey,
      amount,
      {
        orderId: providerOrderId,
        paymentKey: providerPaymentKey,
        status: "DONE",
        totalAmount: amount,
      },
    ],
  )

  assert.equal(result.rows.length, 1)

  return result.rows[0]
}

export async function markPaymentConfirmationFailed(db) {
  await db.query("select public.mark_payment_confirmation_failed($1, $2, $3, $4)", [
    reservationId,
    providerOrderId,
    "verification_failed",
    { provider: "toss", type: "verification_failed" },
  ])
}

export async function markPaymentConfirmationReconciliationRequired(db, options = {}) {
  const amount = options.amount ?? 10001
  const failureCode = options.failureCode ?? "P0003"
  const paymentKey = options.paymentKey ?? providerPaymentKey
  const orderId = options.orderId ?? providerOrderId
  const rawPayload = options.rawPayload ?? {
    orderId,
    paymentKey,
    status: "DONE",
    totalAmount: amount,
  }

  await db.query(
    "select public.mark_payment_confirmation_reconciliation_required($1, $2, $3, $4, $5)",
    [reservationId, orderId, paymentKey, failureCode, rawPayload],
  )
}

function extractFunction(sql, startMarker, endMarker) {
  const functionStart = sql.indexOf(`create or replace function ${startMarker}`)
  const functionEnd = sql.indexOf(endMarker, functionStart)

  assert.notEqual(functionStart, -1)
  assert.notEqual(functionEnd, -1)

  return sql.slice(functionStart, functionEnd)
}
