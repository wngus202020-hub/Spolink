begin;

create extension if not exists pgtap;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '61000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'boundary-report@example.test',
  '',
  statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  statement_timestamp(),
  statement_timestamp()
), (
  '00000000-0000-0000-0000-000000000000',
  '61000000-0000-4000-8000-000000000003',
  'authenticated',
  'authenticated',
  'boundary-admin@example.test',
  '',
  statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  statement_timestamp(),
  statement_timestamp()
), (
  '00000000-0000-0000-0000-000000000000',
  '61000000-0000-4000-8000-000000000004',
  'authenticated',
  'authenticated',
  'boundary-coach@example.test',
  '',
  statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  statement_timestamp(),
  statement_timestamp()
), (
  '00000000-0000-0000-0000-000000000000',
  '61000000-0000-4000-8000-000000000005',
  'authenticated',
  'authenticated',
  'boundary-foreign@example.test',
  '',
  statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  statement_timestamp(),
  statement_timestamp()
), (
  '00000000-0000-0000-0000-000000000000',
  '61000000-0000-4000-8000-000000000006',
  'authenticated',
  'authenticated',
  'boundary-suspended-admin@example.test',
  '',
  statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  statement_timestamp(),
  statement_timestamp()
);

insert into public.profiles (id, display_name, role, status)
values
  ('61000000-0000-4000-8000-000000000001', 'Boundary reporter', 'learner', 'active'),
  ('61000000-0000-4000-8000-000000000003', 'Boundary admin', 'admin', 'active'),
  ('61000000-0000-4000-8000-000000000004', 'Boundary coach', 'learner', 'coach_approved'),
  ('61000000-0000-4000-8000-000000000005', 'Boundary foreign', 'learner', 'active'),
  ('61000000-0000-4000-8000-000000000006', 'Boundary suspended admin', 'admin', 'suspended');

insert into public.coach_profiles (id, user_id, status, service_region)
values (
  '62000000-0000-4000-8000-000000000004',
  '61000000-0000-4000-8000-000000000004',
  'approved',
  '서울'
);

insert into public.lessons (
  id, coach_profile_id, sport_id, status, title, description, region,
  duration_minutes, price_amount, capacity
)
select
  '63000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000004',
  sports.id,
  'active',
  'Boundary lesson',
  'Boundary lesson description',
  '서울',
  60,
  10000,
  2
from public.sports
order by sports.slug
limit 1;

insert into public.lesson_schedules (
  id, lesson_id, starts_at, ends_at, capacity, reserved_count
)
values
  (
    '64000000-0000-4000-8000-000000000001',
    '63000000-0000-4000-8000-000000000001',
    statement_timestamp() - interval '1 hour',
    statement_timestamp(),
    2,
    1
  ),
  (
    '64000000-0000-4000-8000-000000000002',
    '63000000-0000-4000-8000-000000000001',
    statement_timestamp() + interval '1 hour',
    statement_timestamp() + interval '2 hours',
    2,
    1
  );

insert into public.reservations (
  id, lesson_id, lesson_schedule_id, learner_id, coach_profile_id,
  status, reserved_price_amount
)
values
  (
    '65000000-0000-4000-8000-000000000001',
    '63000000-0000-4000-8000-000000000001',
    '64000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000004',
    'confirmed',
    10000
  ),
  (
    '65000000-0000-4000-8000-000000000002',
    '63000000-0000-4000-8000-000000000001',
    '64000000-0000-4000-8000-000000000002',
    '61000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000004',
    'confirmed',
    10000
  );

insert into public.reservations (
  id, lesson_id, lesson_schedule_id, learner_id, coach_profile_id,
  status, reserved_price_amount, payment_expires_at
)
values
  (
    '65000000-0000-4000-8000-000000000003',
    '63000000-0000-4000-8000-000000000001',
    '64000000-0000-4000-8000-000000000002',
    '61000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000004',
    'pending_payment',
    10000,
    statement_timestamp() + interval '10 minutes'
  ),
  (
    '65000000-0000-4000-8000-000000000004',
    '63000000-0000-4000-8000-000000000001',
    '64000000-0000-4000-8000-000000000002',
    '61000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000004',
    'pending_payment',
    10000,
    statement_timestamp() + interval '10 minutes'
  ),
  (
    '65000000-0000-4000-8000-000000000005',
    '63000000-0000-4000-8000-000000000001',
    '64000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000004',
    'completed',
    10000,
    null
  );

create function pg_temp.set_actor(checked_actor uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', checked_actor::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

create function pg_temp.try_reservation_action(
  checked_actor uuid,
  checked_reservation uuid,
  checked_action public.reservation_status_action,
  checked_reason text
)
returns text
language plpgsql
as $$
begin
  perform pg_temp.set_actor(checked_actor);
  perform * from public.transition_reservation(
    checked_reservation,
    checked_action,
    checked_reason
  );
  return 'NO_ERROR';
exception when others then
  return sqlstate;
end;
$$;

create temporary table action_results (
  reservation_id uuid,
  reservation_status public.reservation_status,
  cancelled_at timestamptz,
  refund_id uuid,
  refund_amount integer,
  refund_status public.refund_status
);

grant select, insert on action_results to authenticated;

create function pg_temp.try_message_report()
returns text
language plpgsql
as $$
begin
  insert into public.reports (reporter_id, target_type, target_id, reason)
  values (
    '61000000-0000-4000-8000-000000000001',
    'message',
    '61000000-0000-4000-8000-000000000002',
    'unsupported target'
  );
  return 'NO_ERROR';
exception when others then
  return sqlstate;
end;
$$;

select is(
  pg_temp.try_message_report(),
  '22P02',
  'message reports are rejected by the stored target allowlist'
);

select is(
  enum_range(null::public.lesson_status_action)::text,
  '{submit,pause,resume,close,approve,reject}',
  'lesson commands are distinct from stored lesson statuses'
);

select is(
  enum_range(null::public.reservation_status_action)::text,
  '{complete,mark_learner_no_show,mark_coach_no_show,open_dispute,cancel}',
  'reservation commands are distinct from stored reservation statuses'
);

select has_function(
  'public',
  'transition_reservation',
  array['uuid', 'reservation_status_action', 'text'],
  'an authorized RPC consumes the reservation action contract'
);

select is(
  public.reservation_no_show_available_at('2026-08-01 10:00:00+09'::timestamptz),
  '2026-08-01 10:15:00+09'::timestamptz,
  'the no-show threshold is exactly 15 minutes after the KST schedule start'
);

select ok(
  public.is_approved_coach('62000000-0000-4000-8000-000000000004'),
  'approved coach eligibility requires the approved paired account state'
);

select ok(
  not has_table_privilege('authenticated', 'public.reservations', 'UPDATE'),
  'authenticated admins cannot directly update reservation workflow fields'
);

select ok(
  not has_table_privilege('authenticated', 'public.reports', 'INSERT,UPDATE,DELETE'),
  'report writes are workflow only'
);

select ok(
  not has_table_privilege('authenticated', 'public.reviews', 'INSERT,UPDATE,DELETE'),
  'review writes are workflow only'
);

select ok(
  not has_table_privilege('authenticated', 'public.settlements', 'INSERT,UPDATE,DELETE'),
  'settlement status and amounts are workflow only'
);

select ok(
  has_column_privilege('authenticated', 'public.notifications', 'read_at', 'UPDATE'),
  'notification owners receive only the read timestamp update grant'
);

create function pg_temp.try_unsafe_notification()
returns text
language plpgsql
as $$
begin
  insert into public.notifications (user_id, type, title, data)
  values (
    '61000000-0000-4000-8000-000000000001',
    'reservation.completed',
    '완료',
    '{"reservationId":"safe-id","email":"not-allowed"}'::jsonb
  );
  return 'NO_ERROR';
exception when others then
  return sqlstate;
end;
$$;

select is(
  pg_temp.try_unsafe_notification(),
  '23514',
  'notification JSON rejects keys outside the per-type redaction allowlist'
);

create function pg_temp.try_locked_schedule_change()
returns text
language plpgsql
as $$
begin
  update public.lesson_schedules
  set starts_at = starts_at + interval '1 minute'
  where id = '64000000-0000-4000-8000-000000000001';
  return 'NO_ERROR';
exception when others then
  return sqlstate;
end;
$$;

select is(
  pg_temp.try_locked_schedule_change(),
  'P0001',
  'confirmed reservations lock schedule commerce fields'
);

create function pg_temp.try_early_no_show()
returns text
language plpgsql
as $$
begin
  update public.reservations
  set status = 'no_show_user', no_show_marked_at = statement_timestamp()
  where id = '65000000-0000-4000-8000-000000000002';
  return 'NO_ERROR';
exception when others then
  return sqlstate;
end;
$$;

select is(
  pg_temp.try_early_no_show(),
  '22023',
  'no-show transition rejects a schedule before its 15-minute threshold'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.transition_reservation(uuid, public.reservation_status_action, text)',
    'EXECUTE'
  ) and not has_function_privilege(
    'anon',
    'public.transition_reservation(uuid, public.reservation_status_action, text)',
    'EXECUTE'
  ),
  'only authenticated callers receive the action RPC grant'
);

set local role authenticated;
select pg_temp.set_actor('61000000-0000-4000-8000-000000000001');

insert into action_results
select * from public.transition_reservation(
  '65000000-0000-4000-8000-000000000003',
  'cancel',
  'shared boundary cancellation'
);

select is(
  (select reservation_status::text from action_results limit 1),
  'cancelled_by_user',
  'valid cancel action derives and stores the learner cancellation status'
);

select ok(
  (select cancelled_at = transaction_timestamp() from action_results limit 1),
  'the action RPC derives its transition timestamp from the server transaction'
);

select ok(
  (select refund_amount is null from action_results limit 1)
  and (select reserved_price_amount = 10000 from public.reservations
    where id = '65000000-0000-4000-8000-000000000003'),
  'the action RPC accepts no amount and preserves the server-owned stored amount'
);

insert into action_results
select * from public.transition_reservation(
  '65000000-0000-4000-8000-000000000003',
  'cancel',
  'shared boundary cancellation'
);

reset role;

select ok(
  (select count(*) = 2 and min(cancelled_at) = max(cancelled_at) from action_results)
  and (select count(*) = 1 from public.audit_logs
    where target_id = '65000000-0000-4000-8000-000000000003'
      and action = 'reservation.cancelled'),
  'identical replay returns the original transition without duplicate effects'
);

set local role authenticated;

select is(
  pg_temp.try_reservation_action(
    '61000000-0000-4000-8000-000000000001',
    '65000000-0000-4000-8000-000000000004',
    'complete',
    'unsupported action'
  ),
  '22023',
  'actions reserved for later workflows are rejected without changing state'
);

select is(
  pg_temp.try_reservation_action(
    '61000000-0000-4000-8000-000000000005',
    '65000000-0000-4000-8000-000000000004',
    'cancel',
    'foreign cancellation'
  ),
  '42501',
  'a foreign actor cannot execute the accepted action'
);

select is(
  pg_temp.try_reservation_action(
    '61000000-0000-4000-8000-000000000006',
    '65000000-0000-4000-8000-000000000004',
    'cancel',
    'suspended admin cancellation'
  ),
  '42501',
  'an inactive privileged role cannot execute the accepted action'
);

select is(
  pg_temp.try_reservation_action(
    '61000000-0000-4000-8000-000000000001',
    '65000000-0000-4000-8000-000000000005',
    'cancel',
    'invalid state cancellation'
  ),
  'P0001',
  'the accepted action rejects an invalid stored state'
);

select is(
  (select status::text from public.reservations
    where id = '65000000-0000-4000-8000-000000000004'),
  'pending_payment',
  'failed action and authorization attempts leave stored state unchanged'
);

reset role;

select * from finish();
rollback;
