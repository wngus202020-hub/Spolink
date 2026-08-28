begin;
select plan(12);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '77000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'task7-a@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '77000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'task7-b@test.invalid', '', now(), '{}', '{}', now(), now());

insert into public.profiles (id, display_name, role, status) values
  ('77000000-0000-4000-8000-000000000001', 'Task 7 A', 'learner', 'active'),
  ('77000000-0000-4000-8000-000000000002', 'Task 7 B', 'coach', 'coach_approved');

insert into public.coach_profiles (id, user_id, status, service_region)
values ('77300000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000002', 'approved', '서울');
insert into public.lessons (id, coach_profile_id, sport_id, status, title, description, region, duration_minutes, price_amount, capacity)
select '77400000-0000-4000-8000-000000000001', '77300000-0000-4000-8000-000000000001', id, 'active', 'Task 7', 'Task 7', '서울', 60, 10000, 1
from public.sports limit 1;
insert into public.lesson_schedules (id, lesson_id, starts_at, ends_at, capacity, reserved_count)
values ('77500000-0000-4000-8000-000000000001', '77400000-0000-4000-8000-000000000001', now() + interval '1 day', now() + interval '1 day 1 hour', 1, 1);
insert into public.reservations (id, lesson_id, lesson_schedule_id, learner_id, coach_profile_id, status, reserved_price_amount)
values ('77600000-0000-4000-8000-000000000001', '77400000-0000-4000-8000-000000000001', '77500000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000001', '77300000-0000-4000-8000-000000000001', 'confirmed', 10000);
insert into public.payments (id, reservation_id, payer_id, status, provider_order_id, amount)
values ('77700000-0000-4000-8000-000000000001', '77600000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000001', 'paid', 'task7-order', 10000);

select set_config('request.jwt.claims', '{"sub":"77000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '77000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is((select count(*)::integer from public.emit_notification_once(
  '77000000-0000-4000-8000-000000000001', 'review.requested', '후기 요청', null,
  '{"reservationId":"77100000-0000-4000-8000-000000000001","lessonId":"77200000-0000-4000-8000-000000000001"}', 'task7:review:1'
)), 1, 'first event inserts one row');
select is((select idempotent from public.emit_notification_once(
  '77000000-0000-4000-8000-000000000001', 'review.requested', '후기 요청', null,
  '{"reservationId":"77100000-0000-4000-8000-000000000001","lessonId":"77200000-0000-4000-8000-000000000001"}', 'task7:review:1'
)), true, 'same event replay is idempotent');
select is((select count(*)::integer from public.notifications where event_key = 'task7:review:1'), 1, 'replay has one persisted effect');

set local role authenticated;
select is((select count(*)::integer from public.notifications), 1, 'owner sees only own notification');
select is((select has_column_privilege('authenticated', 'public.notifications', 'event_key', 'SELECT')), false, 'internal event key is not readable');
select is((select has_column_privilege('authenticated', 'public.notifications', 'read_at', 'UPDATE')), true, 'owner read column is writable');
select is((select count(*)::integer from public.notifications where user_id = '77000000-0000-4000-8000-000000000002'), 0, 'foreign notification is not visible');

select is((select count(*)::integer from public.notifications where data ? 'email'), 0, 'safe payload excludes email');
set local role postgres;
select throws_ok($$select public.emit_notification_once(
  '77000000-0000-4000-8000-000000000001', 'review.requested', 'bad', null,
  '{"reservationId":"77100000-0000-4000-8000-000000000001","nested":{"secret":true}}', 'task7:bad'
)$$, '22023', 'Notification data is not allowed.', 'nested payload is rejected');

insert into public.refunds (id, payment_id, reservation_id, requested_by, amount, reason, source, status, provider_refund_key, processed_at)
values ('77800000-0000-4000-8000-000000000001', '77700000-0000-4000-8000-000000000001', '77600000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000001', 10000, 'task7', 'manual', 'completed', 'task7-provider-result', now());
select is((select count(*)::integer from public.notifications where type = 'refund.result' and data->>'refundId' = '77800000-0000-4000-8000-000000000001'), 1, 'refund result trigger emits once');
update public.refunds set status = 'completed' where id = '77800000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.notifications where type = 'refund.result' and data->>'refundId' = '77800000-0000-4000-8000-000000000001'), 1, 'refund result replay stays one');
insert into public.settlements (id, reservation_id, coach_profile_id, payment_id, gross_amount, net_amount)
values ('77900000-0000-4000-8000-000000000001', '77600000-0000-4000-8000-000000000001', '77300000-0000-4000-8000-000000000001', '77700000-0000-4000-8000-000000000001', 10000, 10000);
update public.settlements set status = 'approved' where id = '77900000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.notifications where type = 'settlement.status_changed' and data->>'settlementId' = '77900000-0000-4000-8000-000000000001'), 1, 'settlement status trigger emits once');

select finish();
rollback;
