begin;

create extension if not exists pgtap;
select no_plan();

create temp table task5_actor (
  actor_key text primary key,
  id uuid not null,
  role public.user_role not null,
  status public.user_status not null
) on commit drop;

insert into task5_actor values
  ('admin', '57000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('inactive_admin', '57000000-0000-4000-8000-000000000002', 'admin', 'suspended'),
  ('learner', '57000000-0000-4000-8000-000000000003', 'learner', 'active'),
  ('foreign', '57000000-0000-4000-8000-000000000004', 'learner', 'active'),
  ('self', '57000000-0000-4000-8000-000000000005', 'learner', 'active'),
  ('coach', '57000000-0000-4000-8000-000000000006', 'coach', 'coach_approved');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
  actor_key || '@task5-review.test', '', statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  statement_timestamp(), statement_timestamp()
from task5_actor;

insert into public.profiles (id, display_name, role, status)
select id, 'Task5 ' || actor_key, role, status from task5_actor;

create function pg_temp.task5_id(checked_key text)
returns uuid language sql stable as $$ select id from task5_actor where actor_key = checked_key $$;

insert into public.coach_profiles (id, user_id, status, service_region)
values
  ('57100000-0000-4000-8000-000000000001', pg_temp.task5_id('coach'), 'approved', '서울'),
  ('57100000-0000-4000-8000-000000000002', pg_temp.task5_id('self'), 'approved', '서울');

create temp table task5_case (
  case_key text primary key,
  lesson_id uuid not null,
  schedule_id uuid not null,
  reservation_id uuid not null,
  learner_id uuid not null,
  coach_profile_id uuid not null,
  reservation_status public.reservation_status not null,
  payment_status public.payment_status
) on commit drop;

insert into task5_case values
  ('valid', '57200000-0000-4000-8000-000000000001', '57300000-0000-4000-8000-000000000001', '57400000-0000-4000-8000-000000000001', pg_temp.task5_id('learner'), '57100000-0000-4000-8000-000000000001', 'completed', 'paid'),
  ('no_show', '57200000-0000-4000-8000-000000000002', '57300000-0000-4000-8000-000000000002', '57400000-0000-4000-8000-000000000002', pg_temp.task5_id('learner'), '57100000-0000-4000-8000-000000000001', 'no_show_user', 'paid'),
  ('refunded', '57200000-0000-4000-8000-000000000003', '57300000-0000-4000-8000-000000000003', '57400000-0000-4000-8000-000000000003', pg_temp.task5_id('learner'), '57100000-0000-4000-8000-000000000001', 'completed', 'refunded'),
  ('refund_row', '57200000-0000-4000-8000-000000000004', '57300000-0000-4000-8000-000000000004', '57400000-0000-4000-8000-000000000004', pg_temp.task5_id('learner'), '57100000-0000-4000-8000-000000000001', 'completed', 'paid'),
  ('incomplete', '57200000-0000-4000-8000-000000000005', '57300000-0000-4000-8000-000000000005', '57400000-0000-4000-8000-000000000005', pg_temp.task5_id('learner'), '57100000-0000-4000-8000-000000000001', 'confirmed', 'paid'),
  ('foreign', '57200000-0000-4000-8000-000000000006', '57300000-0000-4000-8000-000000000006', '57400000-0000-4000-8000-000000000006', pg_temp.task5_id('foreign'), '57100000-0000-4000-8000-000000000001', 'completed', 'paid'),
  ('self_review', '57200000-0000-4000-8000-000000000007', '57300000-0000-4000-8000-000000000007', '57400000-0000-4000-8000-000000000007', pg_temp.task5_id('self'), '57100000-0000-4000-8000-000000000002', 'completed', 'paid'),
  ('invalid', '57200000-0000-4000-8000-000000000008', '57300000-0000-4000-8000-000000000008', '57400000-0000-4000-8000-000000000008', pg_temp.task5_id('learner'), '57100000-0000-4000-8000-000000000001', 'completed', 'paid'),
  ('hide', '57200000-0000-4000-8000-000000000009', '57300000-0000-4000-8000-000000000009', '57400000-0000-4000-8000-000000000009', pg_temp.task5_id('learner'), '57100000-0000-4000-8000-000000000001', 'completed', 'paid');

insert into public.lessons (id, coach_profile_id, sport_id, status, title, description, region, duration_minutes, price_amount, capacity)
select c.lesson_id, c.coach_profile_id, s.id, 'active', 'Task5 review lesson ' || c.case_key,
  'Task5 behavioral review fixture', '서울', 60, 10000, 2
from task5_case c cross join lateral (select id from public.sports where slug = 'tennis' limit 1) s;

insert into public.lesson_schedules (id, lesson_id, starts_at, ends_at, capacity, reserved_count)
select schedule_id, lesson_id, now() + interval '1 day', now() + interval '1 day 1 hour', 2, 1
from task5_case;

insert into public.reservations (id, lesson_id, lesson_schedule_id, learner_id, coach_profile_id, status, reserved_price_amount)
select reservation_id, lesson_id, schedule_id, learner_id, coach_profile_id, reservation_status, 10000
from task5_case;

insert into public.payments (reservation_id, payer_id, status, provider_order_id, amount)
select reservation_id, learner_id, payment_status, 'task5_' || case_key, 10000
from task5_case where payment_status is not null;

insert into public.refunds (payment_id, reservation_id, requested_by, amount, reason, status, provider_refund_key, processed_at)
select p.id, c.reservation_id, c.learner_id, 10000, 'Task5 completed refund', 'completed'
  , 'task5-provider-result', now()
from task5_case c join public.payments p on p.reservation_id = c.reservation_id
where c.case_key = 'refund_row';

grant select on task5_actor, task5_case to authenticated;
create temp table task5_review (review_id uuid not null) on commit drop;
grant select, insert on task5_review to authenticated;
grant select on task5_review to anon;

create function pg_temp.set_task5_auth(checked_actor uuid)
returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', checked_actor, 'role', 'authenticated')::text, true);
  select set_config('request.jwt.claim.sub', checked_actor::text, true);
  select set_config('request.jwt.claim.role', 'authenticated', true);
$$;

select has_function('public', 'create_review', array['uuid', 'integer', 'text'], 'learner create RPC exists');
select has_function('public', 'hide_review', array['uuid', 'text'], 'admin hide RPC exists');
select ok(not has_table_privilege('authenticated', 'public.reviews', 'INSERT'), 'authenticated cannot insert reviews directly');
select ok(not has_table_privilege('authenticated', 'public.reviews', 'UPDATE'), 'authenticated cannot update reviews directly');
select ok(not has_table_privilege('authenticated', 'public.reviews', 'DELETE'), 'authenticated cannot delete reviews directly');

select pg_temp.set_task5_auth(pg_temp.task5_id('learner'));
set local role authenticated;
select is((select rating::text || '/' || content || '/' || idempotent::text from public.create_review((select reservation_id from task5_case where case_key = 'valid'), 5, '  실제 후기  ')), '5/실제 후기/false', 'completed learner creates one review');
insert into task5_review select id from public.reviews where reservation_id = (select reservation_id from task5_case where case_key = 'valid');
select throws_ok($$select public.create_review((select reservation_id from task5_case where case_key = 'no_show'), 5, '후기')$$, 'P0001', 'Only completed reservations can be reviewed.', 'no-show reservation is ineligible');
select throws_ok($$select public.create_review((select reservation_id from task5_case where case_key = 'refunded'), 5, '후기')$$, 'P0001', 'Refunded reservations cannot be reviewed.', 'refunded payment is ineligible');
select throws_ok($$select public.create_review((select reservation_id from task5_case where case_key = 'refund_row'), 5, '후기')$$, 'P0001', 'Refunded reservations cannot be reviewed.', 'completed refund row is ineligible');
select throws_ok($$select public.create_review((select reservation_id from task5_case where case_key = 'incomplete'), 5, '후기')$$, 'P0001', 'Only completed reservations can be reviewed.', 'incomplete reservation is ineligible');
select throws_ok($$select public.create_review((select reservation_id from task5_case where case_key = 'foreign'), 5, '후기')$$, '42501', 'Only the reservation learner can review.', 'foreign reservation is rejected');
select throws_ok($$select public.create_review((select reservation_id from task5_case where case_key = 'valid'), 4, '중복')$$, '23505', 'A review already exists for this reservation.', 'duplicate review is rejected');
select pg_temp.set_task5_auth(pg_temp.task5_id('self'));
select throws_ok($$select public.create_review((select reservation_id from task5_case where case_key = 'self_review'), 5, '셀프')$$, '42501', 'A coach cannot review their own lesson.', 'self review is rejected');
select throws_ok($$select public.create_review((select reservation_id from task5_case where case_key = 'invalid'), 0, '후기')$$, '22023', 'Rating must be between 1 and 5.', 'invalid rating is rejected');
select throws_ok($$select public.create_review((select reservation_id from task5_case where case_key = 'invalid'), 5, '   ')$$, '22023', 'Review content must be 1 to 2000 characters.', 'blank content is rejected');
reset role;

select pg_temp.set_task5_auth(pg_temp.task5_id('learner'));
set local role authenticated;
select throws_ok($$insert into public.reviews (reservation_id, lesson_id, coach_profile_id, reviewer_id, rating, content) select reservation_id, lesson_id, coach_profile_id, reviewer_id, 5, 'direct' from (select c.reservation_id, c.lesson_id, c.coach_profile_id, c.learner_id reviewer_id from task5_case c where c.case_key = 'invalid') x$$, '42501', null, 'direct review insert is denied');
reset role;

select pg_temp.set_task5_auth(pg_temp.task5_id('admin'));
set local role authenticated;
select is((select status::text || '/' || idempotent::text from public.hide_review((select review_id from task5_review), '정책 위반')), 'hidden/false', 'active admin hides review');
select is((select status::text || '/' || idempotent::text from public.hide_review((select review_id from task5_review), '정책 위반')), 'hidden/true', 'same hide decision is idempotent');
select throws_ok($$select public.hide_review((select review_id from task5_review), '다른 사유')$$, 'P0001', 'Review state has changed.', 'conflicting hide decision is stale');
select is((select count(*) from public.audit_logs where action = 'review.hidden' and target_id = (select review_id from task5_review)), 1::bigint, 'hide writes exactly one audit row');
select ok((select before_data = '{"status":"visible"}'::jsonb and after_data = '{"reason":"정책 위반","status":"hidden"}'::jsonb from public.audit_logs where action = 'review.hidden' and target_id = (select review_id from task5_review)), 'hide audit is redacted to status and reason');
select throws_ok($$update public.reviews set status = 'visible' where id = (select review_id from task5_review)$$, '42501', null, 'direct review update is denied');
select throws_ok($$delete from public.reviews where id = (select review_id from task5_review)$$, '42501', null, 'direct review delete is denied');
reset role;

select pg_temp.set_task5_auth(pg_temp.task5_id('inactive_admin'));
set local role authenticated;
select throws_ok($$select public.hide_review((select review_id from task5_review), 'inactive')$$, '42501', 'Active administrator required.', 'inactive admin cannot hide');
reset role;

set local role anon;
select is((select count(*) from public.reviews where id = (select review_id from task5_review)), 0::bigint, 'hidden review is omitted from public reads');
reset role;

select * from finish();
rollback;
