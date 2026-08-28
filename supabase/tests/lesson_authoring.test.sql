begin;

create extension if not exists pgtap;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'lesson-approved@example.test', '', statement_timestamp(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   statement_timestamp(), statement_timestamp()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'lesson-pending@example.test', '', statement_timestamp(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   statement_timestamp(), statement_timestamp()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'lesson-admin@example.test', '', statement_timestamp(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   statement_timestamp(), statement_timestamp()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'lesson-foreign@example.test', '', statement_timestamp(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   statement_timestamp(), statement_timestamp());

insert into public.profiles (id, display_name, role, status)
values
  ('71000000-0000-4000-8000-000000000001', 'Approved coach', 'learner', 'coach_approved'),
  ('71000000-0000-4000-8000-000000000002', 'Pending coach', 'learner', 'pending_coach'),
  ('71000000-0000-4000-8000-000000000003', 'Lesson admin', 'admin', 'active'),
  ('71000000-0000-4000-8000-000000000004', 'Foreign coach', 'learner', 'coach_approved');

insert into public.sports (id, name, slug, is_active)
values ('71000000-0000-4000-8000-000000000010', 'Task2 Tennis', 'task2-tennis', true);

insert into public.coach_profiles (id, user_id, status, service_region)
values
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001',
   'approved', '서울 강남구'),
  ('72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000002',
   'submitted', '서울 강남구'),
  ('72000000-0000-4000-8000-000000000004', '71000000-0000-4000-8000-000000000004',
   'approved', '서울 송파구');

create function pg_temp.set_lesson_actor(checked_actor uuid)
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', checked_actor, 'role', 'authenticated')::text, true);
  select set_config('request.jwt.claim.sub', checked_actor::text, true);
  select set_config('request.jwt.claim.role', 'authenticated', true);
$$;

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_lesson_draft(uuid,text,text,text,text,text,text,integer,integer,integer,text,text)',
    'EXECUTE'
  ),
  'authenticated sessions may reach the approved-coach RPC check'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.create_lesson_draft(uuid,text,text,text,text,text,text,integer,integer,integer,text,text)',
    'EXECUTE'
  ),
  'anonymous sessions cannot create lesson drafts'
);
select ok(
  not has_table_privilege('authenticated', 'public.lessons', 'INSERT,UPDATE,DELETE'),
  'direct lesson writes remain denied'
);
select ok(
  not has_table_privilege('authenticated', 'public.lesson_schedules', 'INSERT,UPDATE,DELETE'),
  'direct schedule writes remain denied'
);

select pg_temp.set_lesson_actor('71000000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.create_lesson_draft(
    '71000000-0000-4000-8000-000000000010', 'Pending lesson', null,
    'Pending coaches cannot save this lesson.', '서울 강남구', null, null,
    60, 50000, 4, null, null
  )$$,
  'P0001', 'COACH_NOT_APPROVED',
  'pending coaches cannot bypass the approved active coach check'
);
reset role;

select pg_temp.set_lesson_actor('71000000-0000-4000-8000-000000000001');
set local role authenticated;
create temporary table created_lesson on commit drop as
select * from public.create_lesson_draft(
  '71000000-0000-4000-8000-000000000010', 'Approved lesson', 'Safe rally basics',
  'Approved coaches can save a complete lesson draft.', '서울 강남구', null,
  'SPOLINK court', 60, 50000, 4, '운동화', '정책 요약'
);
select is((select status::text from created_lesson), 'draft', 'draft create is owner scoped');

select ok(
  not has_function_privilege(
    'anon',
    'public.create_lesson_schedule(uuid,timestamptz,timestamptz,integer)',
    'EXECUTE'
  ),
  'anonymous sessions cannot create schedules'
);

create temporary table submitted_lesson on commit drop as
select result.* from created_lesson lesson,
lateral public.transition_lesson(lesson.id, 'submit', lesson.updated_at, null) result;
select is((select status::text from submitted_lesson), 'pending_review',
  'approved coach submits draft for review');
reset role;

select pg_temp.set_lesson_actor('71000000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  format('select public.transition_lesson(%L,%L,%L,null)',
    (select id from submitted_lesson), 'submit', (select updated_at from submitted_lesson)),
  'P0001', 'LESSON_NOT_FOUND',
  'another approved coach cannot transition an owner lesson'
);
reset role;

select pg_temp.set_lesson_actor('71000000-0000-4000-8000-000000000003');
set local role authenticated;
create temporary table approved_lesson on commit drop as
select result.* from submitted_lesson lesson,
lateral public.transition_lesson(lesson.id, 'approve', lesson.updated_at, null) result;
select is((select status::text from approved_lesson), 'active', 'active admin approves review');
reset role;

select pg_temp.set_lesson_actor('71000000-0000-4000-8000-000000000001');
set local role authenticated;
create temporary table rejected_candidate on commit drop as
select * from public.create_lesson_draft(
  '71000000-0000-4000-8000-000000000010', 'Rejected lesson', null,
  'A rejected lesson can be corrected and submitted again.', '서울 강남구', null,
  null, 60, 50000, 4, null, null
);
create temporary table rejected_pending on commit drop as
select result.* from rejected_candidate lesson,
lateral public.transition_lesson(lesson.id, 'submit', lesson.updated_at, null) result;
reset role;

select pg_temp.set_lesson_actor('71000000-0000-4000-8000-000000000003');
set local role authenticated;
create temporary table rejected_lesson on commit drop as
select result.* from rejected_pending lesson,
lateral public.transition_lesson(lesson.id, 'reject', lesson.updated_at, 'Please clarify location.') result;
select is((select status::text from rejected_lesson), 'rejected', 'admin rejects with a reason');
reset role;

select pg_temp.set_lesson_actor('71000000-0000-4000-8000-000000000001');
set local role authenticated;
create temporary table resubmitted_lesson on commit drop as
select result.* from rejected_lesson lesson,
lateral public.transition_lesson(lesson.id, 'submit', lesson.updated_at, null) result;
select is((select status::text from resubmitted_lesson), 'pending_review',
  'rejected owner lesson can be submitted again');
reset role;

select pg_temp.set_lesson_actor('71000000-0000-4000-8000-000000000001');
set local role authenticated;
create temporary table created_schedule on commit drop as
select result.* from approved_lesson lesson,
lateral public.create_lesson_schedule(
  lesson.id, statement_timestamp() + interval '2 days',
  statement_timestamp() + interval '2 days 1 hour', 4
) result;

create function pg_temp.overlap_error()
returns text
language plpgsql
as $$
begin
  perform public.create_lesson_schedule(
    (select lesson_id from created_schedule),
    statement_timestamp() + interval '2 days 30 minutes',
    statement_timestamp() + interval '2 days 90 minutes',
    4
  );
  return 'NO_ERROR';
exception when others then
  return sqlstate;
end;
$$;

select is(
  pg_temp.overlap_error(), '23P01',
  'database exclusion prevents overlapping schedules for one lesson'
);

reset role;

update public.lesson_schedules
set reserved_count = 2
where id = (select id from created_schedule);
select pg_temp.set_lesson_actor('71000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format('select public.update_lesson_schedule(%L,%L,%L,%L,%L,1)',
    (select id from approved_lesson), (select id from created_schedule),
    (select updated_at from created_schedule),
    (select starts_at from created_schedule), (select ends_at from created_schedule)),
  'P0001', 'VALIDATION_ERROR',
  'schedule capacity cannot fall below the server-owned reserved count'
);
reset role;
update public.lesson_schedules
set reserved_count = 0
where id = (select id from created_schedule);

insert into public.reservations (
  id, lesson_id, lesson_schedule_id, learner_id, coach_profile_id,
  status, reserved_price_amount
)
select '75000000-0000-4000-8000-000000000001', lesson.id, schedule.id,
  '71000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000001',
  'confirmed', 50000
from approved_lesson lesson cross join created_schedule schedule;

select pg_temp.set_lesson_actor('71000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format('select public.update_lesson_schedule(%L,%L,%L,%L,%L,3)',
    (select id from approved_lesson), (select id from created_schedule),
    (select updated_at from created_schedule),
    (select starts_at + interval '1 hour' from created_schedule),
    (select ends_at + interval '1 hour' from created_schedule)),
  'P0001', 'SCHEDULE_HAS_CONFIRMED_RESERVATION',
  'confirmed reservations protect schedule time and capacity'
);
select is(
  (select is_open::text from public.close_lesson_schedule(
    (select id from approved_lesson), (select id from created_schedule),
    (select updated_at from created_schedule))),
  'false', 'a protected schedule can still be closed without mutating reservations'
);
select throws_ok(
  format('select public.update_lesson_schedule(%L,%L,%L,%L,%L,4)',
    (select id from approved_lesson), (select id from created_schedule),
    (select updated_at from created_schedule),
    (select starts_at from created_schedule), (select ends_at from created_schedule)),
  'P0001', 'STALE_SCHEDULE',
  'close versus update with one concurrency token has one winner'
);
reset role;

select * from finish();
rollback;
