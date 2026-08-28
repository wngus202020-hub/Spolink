begin;

create extension if not exists pgtap;
select plan(33);

create temp table task6_actor (
  actor_key text primary key,
  id uuid not null,
  role public.user_role not null,
  status public.user_status not null
) on commit drop;

insert into task6_actor values
  ('reporter', '66000000-0000-4000-8000-000000000001', 'learner', 'active'),
  ('foreign', '66000000-0000-4000-8000-000000000002', 'learner', 'active'),
  ('coach', '66000000-0000-4000-8000-000000000003', 'coach', 'coach_approved'),
  ('admin', '66000000-0000-4000-8000-000000000004', 'admin', 'active'),
  ('inactive_admin', '66000000-0000-4000-8000-000000000005', 'admin', 'suspended'),
  ('second_admin', '66000000-0000-4000-8000-000000000006', 'admin', 'active');

grant select on task6_actor to authenticated;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
  actor_key || '@task6.test', '', statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  statement_timestamp(), statement_timestamp()
from task6_actor;

insert into public.profiles (id, display_name, role, status)
select id, 'Task 6 ' || actor_key, role, status from task6_actor;

insert into public.coach_profiles (id, user_id, status, service_region)
values (
  '66100000-0000-4000-8000-000000000003',
  '66000000-0000-4000-8000-000000000003',
  'approved',
  '서울'
);

insert into public.lessons (
  id, coach_profile_id, sport_id, status, title, description, region,
  duration_minutes, price_amount, capacity
)
select
  lesson_id,
  '66100000-0000-4000-8000-000000000003',
  sports.id,
  'active',
  title,
  'Task 6 lesson description',
  '서울',
  60,
  10000,
  3
from public.sports
cross join (
  values
    ('66200000-0000-4000-8000-000000000001'::uuid, 'Task 6 relationship lesson'),
    ('66200000-0000-4000-8000-000000000002'::uuid, 'Task 6 moderation lesson')
) as fixture(lesson_id, title)
order by sports.slug
limit 2;

insert into public.lesson_schedules (
  id, lesson_id, starts_at, ends_at, capacity, reserved_count
)
values
  (
    '66300000-0000-4000-8000-000000000001',
    '66200000-0000-4000-8000-000000000001',
    statement_timestamp() + interval '1 day',
    statement_timestamp() + interval '1 day 1 hour',
    3,
    1
  ),
  (
    '66300000-0000-4000-8000-000000000002',
    '66200000-0000-4000-8000-000000000002',
    statement_timestamp() + interval '2 days',
    statement_timestamp() + interval '2 days 1 hour',
    3,
    0
  );

insert into public.reservations (
  id, lesson_id, lesson_schedule_id, learner_id, coach_profile_id,
  status, reserved_price_amount, confirmed_at
) values (
  '66400000-0000-4000-8000-000000000001',
  '66200000-0000-4000-8000-000000000001',
  '66300000-0000-4000-8000-000000000001',
  '66000000-0000-4000-8000-000000000001',
  '66100000-0000-4000-8000-000000000003',
  'confirmed',
  10000,
  statement_timestamp()
);

insert into public.reviews (
  id, reservation_id, lesson_id, coach_profile_id, reviewer_id, status, rating, content
) values (
  '66500000-0000-4000-8000-000000000001',
  '66400000-0000-4000-8000-000000000001',
  '66200000-0000-4000-8000-000000000001',
  '66100000-0000-4000-8000-000000000003',
  '66000000-0000-4000-8000-000000000002',
  'visible',
  1,
  'Unsafe public review'
);

create function pg_temp.set_task6_auth(checked_actor uuid)
returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', checked_actor, 'role', 'authenticated')::text,
    true
  );
  select set_config('request.jwt.claim.sub', checked_actor::text, true);
  select set_config('request.jwt.claim.role', 'authenticated', true);
$$;

create function pg_temp.task6_id(checked_key text)
returns uuid language sql stable as $$
  select id from task6_actor where actor_key = checked_key;
$$;

create function pg_temp.try_report(
  checked_target_type public.report_target_type,
  checked_target_id uuid,
  checked_reason text default 'unsafe behavior'
)
returns text language plpgsql as $$
begin
  perform public.create_report(checked_target_type, checked_target_id, checked_reason, null);
  return 'NO_ERROR';
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.try_block(checked_target_id uuid)
returns text language plpgsql as $$
begin
  perform public.create_block(checked_target_id, 'unwanted interaction');
  return 'NO_ERROR';
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.try_reservation(checked_lesson_id uuid, checked_schedule_id uuid)
returns text language plpgsql as $$
begin
  perform public.create_pending_reservation(checked_lesson_id, checked_schedule_id);
  return 'NO_ERROR';
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.try_resolution(
  checked_report_id uuid,
  checked_action public.report_status_action,
  checked_moderation_action public.moderation_action,
  checked_note text
)
returns text language plpgsql as $$
begin
  perform public.resolve_report(
    checked_report_id, checked_action, checked_moderation_action, checked_note
  );
  return 'NO_ERROR';
exception when others then
  return sqlstate;
end;
$$;

select has_function(
  'public', 'create_report', array['report_target_type', 'uuid', 'text', 'text'],
  'report creation is an authenticated RPC boundary'
);
select has_function(
  'public', 'create_block', array['uuid', 'text'],
  'block creation is an authenticated RPC boundary'
);
select has_function(
  'public', 'resolve_report',
  array['uuid', 'report_status_action', 'moderation_action', 'text'],
  'report resolution is an authenticated RPC boundary'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.create_report(report_target_type,uuid,text,text)',
    'EXECUTE'
  ) and not has_function_privilege(
    'anon',
    'public.create_report(report_target_type,uuid,text,text)',
    'EXECUTE'
  ),
  'only authenticated sessions can reach report creation'
);
select is(
  enum_range(null::public.report_target_type)::text,
  '{user,coach,lesson,review,reservation}',
  'message is excluded from report targets'
);

select pg_temp.set_task6_auth(pg_temp.task6_id('reporter'));
set local role authenticated;

select is(
  pg_temp.try_report('user', pg_temp.task6_id('reporter')),
  '42501',
  'self reports are denied'
);
select is(
  pg_temp.try_report('user', pg_temp.task6_id('foreign')),
  '42501',
  'a learner cannot report a foreign user without a commerce relationship'
);
select is(
  pg_temp.try_report('coach', '66100000-0000-4000-8000-000000000003'),
  'NO_ERROR',
  'a learner can report a related coach'
);
select is(
  pg_temp.try_report('coach', '66100000-0000-4000-8000-000000000003'),
  '23505',
  'a duplicate open report fails deterministically'
);
select is(
  pg_temp.try_report('reservation', '66400000-0000-4000-8000-000000000001'),
  'NO_ERROR',
  'a learner can report their reservation'
);
select is(
  pg_temp.try_report('review', '66500000-0000-4000-8000-000000000001'),
  'NO_ERROR',
  'a visible foreign review is reportable'
);
select is(
  pg_temp.try_block(pg_temp.task6_id('reporter')),
  '22023',
  'self blocks are denied'
);
select is(
  pg_temp.try_block(pg_temp.task6_id('foreign')),
  '42501',
  'blocks require an existing commerce relationship'
);
select is(
  (
    select blocked_id::text || '/' || idempotent::text
    from public.create_block(pg_temp.task6_id('coach'), 'unwanted interaction')
  ),
  pg_temp.task6_id('coach')::text || '/false',
  'a related user can be blocked once'
);
select is(
  (
    select blocked_id::text || '/' || idempotent::text
    from public.create_block(pg_temp.task6_id('coach'), 'retry ignored')
  ),
  pg_temp.task6_id('coach')::text || '/true',
  'duplicate block creation returns the original relationship idempotently'
);
select is(
  (select status::text from public.reservations where id = '66400000-0000-4000-8000-000000000001'),
  'confirmed',
  'blocking does not alter an existing confirmed reservation'
);
select ok(
  not public.lesson_is_public('66200000-0000-4000-8000-000000000002'),
  'blocked coach lessons are hidden from new learner interactions'
);
select is(
  pg_temp.try_reservation(
    '66200000-0000-4000-8000-000000000002',
    '66300000-0000-4000-8000-000000000002'
  ),
  'P0002',
  'blocked users cannot create a new reservation'
);
select is(
  pg_temp.try_report('lesson', '66200000-0000-4000-8000-000000000002'),
  'NO_ERROR',
  'blocking does not suppress a safety report about an otherwise active lesson'
);
select ok(
  not has_table_privilege('authenticated', 'public.reports', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.blocks', 'INSERT,UPDATE,DELETE'),
  'report and block tables reject direct writes'
);

reset role;
select pg_temp.set_task6_auth(pg_temp.task6_id('inactive_admin'));
set local role authenticated;
select is(
  pg_temp.try_resolution(
    (select id from public.reports where target_type = 'lesson'),
    'start_review', 'none', null
  ),
  '42501',
  'a suspended admin cannot review reports'
);

reset role;
select pg_temp.set_task6_auth(pg_temp.task6_id('admin'));
set local role authenticated;
select is(
  (
    select report_status::text || '/' || idempotent::text
    from public.resolve_report(
      (select id from public.reports where target_type = 'lesson'),
      'start_review', 'none', null
    )
  ),
  'reviewing/false',
  'an active admin atomically starts review'
);
select is(
  pg_temp.try_resolution(
    (select id from public.reports where target_type = 'lesson'),
    'resolve', 'hide_review', 'target mismatch'
  ),
  '22023',
  'moderation actions must match the report target'
);
select is(
  (
    select report_status::text || '/' || moderation_action::text || '/' || idempotent::text
    from public.resolve_report(
      (select id from public.reports where target_type = 'lesson'),
      'resolve', 'hide_lesson', 'verified policy violation'
    )
  ),
  'resolved/hide_lesson/false',
  'resolution records and applies an explicit allowed moderation action'
);
select is(
  (
    select report_status::text || '/' || idempotent::text
    from public.resolve_report(
      (select id from public.reports where target_type = 'lesson'),
      'resolve', 'hide_lesson', 'verified policy violation'
    )
  ),
  'resolved/true',
  'an exact resolution retry is idempotent'
);
select is(
  (select status::text from public.lessons where id = '66200000-0000-4000-8000-000000000002'),
  'paused',
  'hide lesson moderation prevents new lesson interactions'
);
select is(
  (
    select count(*)::integer from public.audit_logs
    where target_type = 'report'
      and target_id = (select id from public.reports where target_type = 'lesson')
  ),
  2,
  'start and resolve each write one audit row without retry duplication'
);
select is(
  (
    select count(*)::integer from public.notifications
    where type = 'report.resolved'
      and data ->> 'reportId' = (
        select id::text from public.reports where target_type = 'lesson'
      )
  ),
  1,
  'terminal report resolution writes one redacted notification'
);
select ok(
  not exists (
    select 1 from public.audit_logs
    where target_type = 'report'
      and (
        before_data::text ~* '(reason|detail|email|phone|address|token|cookie)'
        or after_data::text ~* '(reason|detail|email|phone|address|token|cookie)'
      )
  ),
  'moderation audit JSON excludes report text and PII-shaped keys'
);
select is(
  pg_temp.try_resolution(
    (select id from public.reports where target_type = 'lesson'),
    'reject', 'none', 'conflicting decision'
  ),
  'P0001',
  'a stale conflicting terminal decision is rejected'
);

reset role;
select is(
  (select count(*)::integer from public.reports),
  4,
  'failed duplicate and invalid target attempts do not create report rows'
);
select is(
  (select count(*)::integer from public.blocks),
  1,
  'failed and duplicate block attempts leave one block row'
);

select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
set local role anon;
select throws_ok(
  $$select public.create_report(
    'lesson', '66200000-0000-4000-8000-000000000001', 'anonymous', null
  )$$,
  '42501',
  'permission denied for function create_report',
  'anonymous report creation is denied at the execute boundary'
);

select * from finish();
rollback;
