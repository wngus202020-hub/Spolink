import { PGlite } from "@electric-sql/pglite"

import { readPaymentFunction } from "./payment-lock-order-sql-test-helpers.mjs"
import { insertedPaymentId } from "./payment-prepare-sql-test-fixtures.mjs"

export async function createPaymentTestDatabase() {
  const db = new PGlite()
  const createReadyPaymentSql = await readPaymentFunction("create_ready_payment")

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

    create table public.lessons (
      id uuid primary key,
      coach_profile_id uuid not null,
      title text not null
    );

    create table public.reservations (
      id uuid primary key,
      lesson_id uuid not null,
      lesson_schedule_id uuid not null,
      learner_id uuid not null,
      coach_profile_id uuid not null,
      status public.reservation_status not null,
      reserved_price_amount integer not null,
      payment_expires_at timestamptz
    );

    create table public.payments (
      id uuid primary key default '${insertedPaymentId}'::uuid,
      reservation_id uuid not null unique,
      payer_id uuid not null,
      status public.payment_status not null,
      provider text not null default 'toss',
      provider_order_id text not null unique,
      amount integer not null
    );

    create or replace function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create or replace function public.current_user_role()
    returns public.user_role
    language sql
    stable
    security definer
    set search_path = public
    as $$
      select role
      from public.profiles
      where id = auth.uid()
        and status in ('active', 'coach_approved')
    $$;
  `)

  await db.exec(createReadyPaymentSql)

  return db
}
