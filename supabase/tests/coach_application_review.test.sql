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
  ('admin', '50000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('inactive_admin', '50000000-0000-4000-8000-000000000002', 'admin', 'suspended'),
  ('learner', '50000000-0000-4000-8000-000000000003', 'learner', 'active'),
  ('coach', '50000000-0000-4000-8000-000000000004', 'coach', 'coach_approved'),
  ('pending', '50000000-0000-4000-8000-000000000005', 'learner', 'pending_coach'),
  ('approve_target', '50000000-0000-4000-8000-000000000006', 'learner', 'pending_coach'),
  ('reject_target', '50000000-0000-4000-8000-000000000007', 'learner', 'pending_coach'),
  ('draft_target', '50000000-0000-4000-8000-000000000008', 'learner', 'active');

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

insert into public.coach_profiles (
  id, user_id, status, service_region, submitted_at
)
values
  (
    '51000000-0000-4000-8000-000000000006',
    '50000000-0000-4000-8000-000000000006',
    'submitted', '서울 강남구', statement_timestamp()
  ),
  (
    '51000000-0000-4000-8000-000000000007',
    '50000000-0000-4000-8000-000000000007',
    'submitted', '서울 마포구', statement_timestamp()
  ),
  (
    '51000000-0000-4000-8000-000000000008',
    '50000000-0000-4000-8000-000000000008',
    'draft', '서울 성동구', null
  );

insert into public.coach_certificates (
  id, coach_profile_id, certificate_name, file_path
)
values (
  '52000000-0000-4000-8000-000000000006',
  '51000000-0000-4000-8000-000000000006',
  'Task5 Certificate',
  '50000000-0000-4000-8000-000000000006/53000000-0000-4000-8000-000000000006.png'
);

create function pg_temp.set_task5_auth(checked_actor uuid)
returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', checked_actor, 'role', 'authenticated')::text,
    true
  );
  select set_config('request.jwt.claim.sub', checked_actor::text, true);
  select set_config('request.jwt.claim.role', 'authenticated', true);
$$;

create function pg_temp.task5_id(checked_key text)
returns uuid language sql stable as $$
  select id from task5_actor where actor_key = checked_key;
$$;

select has_function(
  'public', 'review_coach_application', array['uuid', 'text', 'text'],
  'review RPC exists'
);
select ok(
  lower(pg_get_functiondef(
    'public.review_coach_application(uuid,text,text)'::regprocedure
  )) like '%security definer%',
  'review RPC is security definer'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.review_coach_application(uuid,text,text)', 'EXECUTE'
  ),
  'authenticated sessions may reach the RPC active-admin check'
);
select ok(
  not has_function_privilege(
    'anon', 'public.review_coach_application(uuid,text,text)', 'EXECUTE'
  ),
  'anonymous sessions cannot execute review RPC'
);

select pg_temp.set_task5_auth(pg_temp.task5_id('admin'));
set local role authenticated;
select is(
  (
    select coach_status::text || '/' || profile_status::text || '/' || idempotent::text
    from public.review_coach_application(
      '51000000-0000-4000-8000-000000000006', 'approve', null
    )
  ),
  'approved/coach_approved/false',
  'approval atomically returns the approved tuple'
);
select is(
  (
    select coach_status::text || '/' || profile_status::text || '/' || idempotent::text
    from public.review_coach_application(
      '51000000-0000-4000-8000-000000000006', 'approve', null
    )
  ),
  'approved/coach_approved/true',
  'same approval retry is idempotent'
);
select throws_ok(
  $$select public.review_coach_application(
      '51000000-0000-4000-8000-000000000006', 'reject', 'opposite'
    )$$,
  'P0001', 'COACH_APPLICATION_CONFLICT',
  'opposite decision conflicts'
);
reset role;

select is(
  (
    select cp.status::text || '/' || p.status::text
    from public.coach_profiles cp join public.profiles p on p.id = cp.user_id
    where cp.id = '51000000-0000-4000-8000-000000000006'
  ),
  'approved/coach_approved',
  'approval changes both state rows'
);
select is(
  (
    select count(*) from public.audit_logs
    where target_id = '51000000-0000-4000-8000-000000000006'
      and action = 'coach_certification.approved'
  ),
  1::bigint,
  'approval writes exactly one audit row'
);
select is(
  (
    select count(*) from public.notifications
    where user_id = pg_temp.task5_id('approve_target')
      and type = 'coach_certification.reviewed'
  ),
  1::bigint,
  'approval writes exactly one notification row'
);
select ok(
  (
    select verified_at is not null from public.coach_certificates
    where id = '52000000-0000-4000-8000-000000000006'
  ),
  'approval verifies certificate metadata in the transaction'
);

select pg_temp.set_task5_auth(pg_temp.task5_id('admin'));
set local role authenticated;
select is(
  (
    select coach_status::text || '/' || profile_status::text
    from public.review_coach_application(
      '51000000-0000-4000-8000-000000000007', 'reject', '  서류를 보완해 주세요.  '
    )
  ),
  'rejected/active',
  'rejection atomically restores the learner account'
);
select throws_ok(
  $$select public.review_coach_application(
      '51000000-0000-4000-8000-000000000008', 'reject', null
    )$$,
  'P0001', 'VALIDATION_ERROR',
  'missing rejection reason is rejected'
);
select throws_ok(
  $$select public.review_coach_application(
      '51000000-0000-4000-8000-000000000008', 'reject', repeat('x', 1001)
    )$$,
  'P0001', 'VALIDATION_ERROR',
  'oversized rejection reason is rejected'
);
select throws_ok(
  $$select public.review_coach_application(
      '51000000-0000-4000-8000-000000000008', 'approve', null
    )$$,
  'P0001', 'COACH_APPLICATION_CONFLICT',
  'wrong application state conflicts'
);
select throws_ok(
  $$select public.review_coach_application(
      '59000000-0000-4000-8000-000000000099', 'approve', null
    )$$,
  'P0001', 'COACH_APPLICATION_NOT_FOUND',
  'unknown application returns not found'
);
reset role;

select is(
  (
    select rejection_reason from public.coach_profiles
    where id = '51000000-0000-4000-8000-000000000007'
  ),
  '서류를 보완해 주세요.',
  'rejection reason is trimmed and stored'
);
select is(
  (
    select count(*) from public.audit_logs
    where target_id = '51000000-0000-4000-8000-000000000007'
  ),
  1::bigint,
  'rejection writes exactly one audit row'
);

update public.coach_profiles
set
  status = 'submitted',
  submitted_at = submitted_at + interval '1 second',
  reviewed_at = null,
  reviewed_by = null,
  rejection_reason = null
where id = '51000000-0000-4000-8000-000000000007';
update public.profiles
set status = 'pending_coach'
where id = pg_temp.task5_id('reject_target');

select pg_temp.set_task5_auth(pg_temp.task5_id('admin'));
set local role authenticated;
select is(
  (
    select coach_status::text || '/' || profile_status::text
    from public.review_coach_application(
      '51000000-0000-4000-8000-000000000007', 'approve', null
    )
  ),
  'approved/coach_approved',
  'a resubmitted rejected application can be reviewed in a new cycle'
);
reset role;
select is(
  (
    select count(*) from public.audit_logs
    where target_id = '51000000-0000-4000-8000-000000000007'
  ),
  2::bigint,
  'each submission cycle writes exactly one audit row'
);
select is(
  (
    select count(*) from public.notifications
    where user_id = pg_temp.task5_id('reject_target')
      and type = 'coach_certification.reviewed'
  ),
  2::bigint,
  'each submission cycle writes exactly one notification row'
);

select pg_temp.set_task5_auth(pg_temp.task5_id('learner'));
set local role authenticated;
select throws_ok(
  $$select public.review_coach_application(
      '51000000-0000-4000-8000-000000000008', 'approve', null
    )$$,
  'P0001', 'FORBIDDEN', 'learner review is forbidden'
);
reset role;

select pg_temp.set_task5_auth(pg_temp.task5_id('coach'));
set local role authenticated;
select throws_ok(
  $$select public.review_coach_application(
      '51000000-0000-4000-8000-000000000008', 'approve', null
    )$$,
  'P0001', 'FORBIDDEN', 'coach review is forbidden'
);
reset role;

select pg_temp.set_task5_auth(pg_temp.task5_id('pending'));
set local role authenticated;
select throws_ok(
  $$select public.review_coach_application(
      '51000000-0000-4000-8000-000000000008', 'approve', null
    )$$,
  'P0001', 'FORBIDDEN', 'pending coach review is forbidden'
);
reset role;

select pg_temp.set_task5_auth(pg_temp.task5_id('inactive_admin'));
set local role authenticated;
select throws_ok(
  $$select public.review_coach_application(
      '51000000-0000-4000-8000-000000000008', 'approve', null
    )$$,
  'P0001', 'FORBIDDEN', 'inactive admin review is forbidden'
);
reset role;

set local role anon;
select throws_ok(
  $$select public.review_coach_application(
      '51000000-0000-4000-8000-000000000008', 'approve', null
    )$$,
  '42501', 'permission denied for function review_coach_application',
  'anonymous execution is rejected'
);
reset role;

select * from finish();
rollback;
