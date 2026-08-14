begin;

create extension if not exists pgtap;

select no_plan();

create temp table task4_actor (
  actor_key text primary key,
  id uuid not null,
  profile_status public.user_status not null,
  coach_status public.coach_status not null
) on commit drop;

insert into task4_actor values
  ('valid', '40000000-0000-4000-8000-000000000001', 'active', 'draft'),
  ('zero_cert', '40000000-0000-4000-8000-000000000002', 'active', 'draft'),
  ('incomplete', '40000000-0000-4000-8000-000000000003', 'active', 'draft'),
  ('rejected', '40000000-0000-4000-8000-000000000004', 'active', 'rejected'),
  ('submitted', '40000000-0000-4000-8000-000000000005', 'pending_coach', 'submitted'),
  ('approved', '40000000-0000-4000-8000-000000000006', 'coach_approved', 'approved'),
  ('suspended', '40000000-0000-4000-8000-000000000007', 'suspended', 'suspended');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
  actor_key || '@task4-coach-submit.test', '', statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  statement_timestamp(), statement_timestamp()
from task4_actor;

insert into public.profiles (
  id, display_name, real_name, phone, avatar_path, default_region, role, status
)
select
  id, 'Task4 Applicant', 'Task4 Applicant', '010-0000-0000',
  'profiles/' || id::text || '/avatar.png', '서울 강남구', 'learner', profile_status
from task4_actor;

insert into public.sports (id, name, slug, is_active)
values
  ('40000000-0000-4000-8000-000000000098', 'Task4 Inactive', 'task4-inactive', false),
  ('40000000-0000-4000-8000-000000000099', 'Task4 Tennis', 'task4-tennis', true);

insert into public.coach_profiles (
  id, user_id, status, primary_sport_id, service_region, headline, bio, career_years,
  bank_name, bank_account_last4, payout_holder_name, submitted_at, reviewed_at,
  reviewed_by, rejection_reason
)
select
  ('41000000-0000-4000-8000-' || right(id::text, 12))::uuid,
  id, coach_status, '40000000-0000-4000-8000-000000000099', '서울 강남구',
  case when actor_key = 'incomplete' then null else 'Task4 Coach' end,
  'Task4 coach application biography', 3, 'SPOLINK Bank', '1234', 'Task4 Applicant',
  case when coach_status in ('submitted', 'approved', 'suspended') then statement_timestamp() else null end,
  case when coach_status in ('approved', 'suspended') then statement_timestamp() else null end,
  null,
  case when coach_status = 'rejected' then 'Previous rejection' else null end
from task4_actor;

insert into storage.objects (bucket_id, name, owner_id, metadata)
select
  'coach-certificates',
  id::text || '/42000000-0000-4000-8000-' || right(id::text, 12) || '.png',
  id::text,
  '{"mimetype":"image/png","size":8}'::jsonb
from task4_actor
where actor_key not in ('zero_cert', 'incomplete');

insert into public.coach_certificates (
  coach_profile_id, certificate_name, file_path
)
select
  ('41000000-0000-4000-8000-' || right(id::text, 12))::uuid,
  'Task4 Certificate',
  id::text || '/42000000-0000-4000-8000-' || right(id::text, 12) || '.png'
from task4_actor
where actor_key not in ('zero_cert', 'incomplete');

create function pg_temp.set_task4_auth(checked_actor uuid)
returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', checked_actor, 'role', 'authenticated')::text,
    true
  );
  select set_config('request.jwt.claim.sub', checked_actor::text, true);
  select set_config('request.jwt.claim.role', 'authenticated', true);
$$;

create function pg_temp.task4_id(checked_key text)
returns uuid language sql stable as $$
  select id from task4_actor where actor_key = checked_key;
$$;

select has_function('public', 'submit_coach_application', array[]::text[], 'submit RPC exists');
select has_function(
  'public',
  'upsert_coach_application_draft',
  array['uuid', 'text', 'text', 'text', 'integer', 'text', 'text', 'text'],
  'draft upsert RPC exists'
);
select ok(
  lower(pg_get_functiondef(
    'public.upsert_coach_application_draft(uuid,text,text,text,integer,text,text,text)'::regprocedure
  )) like '%security definer%',
  'draft upsert RPC is security definer'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.upsert_coach_application_draft(uuid,text,text,text,integer,text,text,text)',
    'EXECUTE'
  ),
  'authenticated may execute draft upsert RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.upsert_coach_application_draft(uuid,text,text,text,integer,text,text,text)',
    'EXECUTE'
  ),
  'anonymous may not execute draft upsert RPC'
);
select ok(
  lower(pg_get_functiondef('public.submit_coach_application()'::regprocedure)) like '%security definer%',
  'submit RPC is security definer'
);
select ok(
  lower(pg_get_functiondef('public.submit_coach_application()'::regprocedure))
    like '%from public.profiles%for update%',
  'submit RPC locks the account profile row'
);
select ok(
  lower(pg_get_functiondef('public.submit_coach_application()'::regprocedure))
    like '%from public.coach_profiles%for update%',
  'submit RPC locks the coach profile row'
);
select ok(
  has_function_privilege('authenticated', 'public.submit_coach_application()', 'EXECUTE'),
  'authenticated may execute submit RPC'
);
select ok(
  not has_function_privilege('anon', 'public.submit_coach_application()', 'EXECUTE'),
  'anonymous may not execute submit RPC'
);
select ok(
  not has_table_privilege('authenticated', 'public.coach_profiles', 'UPDATE'),
  'authenticated has no direct coach profile update privilege'
);
select ok(
  not has_table_privilege('authenticated', 'public.coach_profiles', 'INSERT'),
  'authenticated has no direct coach profile insert privilege'
);

select is(
  (select count(*)::integer from task4_actor a join public.profiles p on p.id = a.id
    where p.role = 'learner' and p.status = a.profile_status),
  7,
  'all application tuples preserve role learner and exact account statuses'
);

select pg_temp.set_task4_auth(pg_temp.task4_id('valid'));
set local role authenticated;
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099', '   ', 'Task4 Coach',
      'Task4 biography', 3, 'SPOLINK Bank', '1234', 'Task4 Applicant')$$,
  'P0001', 'VALIDATION_ERROR', 'service region must be trimmed nonempty text'
);
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099', repeat('r', 101), 'Task4 Coach',
      'Task4 biography', 3, 'SPOLINK Bank', '1234', 'Task4 Applicant')$$,
  'P0001', 'VALIDATION_ERROR', 'service region maximum matches Zod limit 100'
);
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099', '서울 강남구', '   ',
      'Task4 biography', 3, 'SPOLINK Bank', '1234', 'Task4 Applicant')$$,
  'P0001', 'VALIDATION_ERROR', 'headline must be trimmed nonempty text'
);
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099', '서울 강남구', repeat('h', 121),
      'Task4 biography', 3, 'SPOLINK Bank', '1234', 'Task4 Applicant')$$,
  'P0001', 'VALIDATION_ERROR', 'headline maximum matches Zod limit 120'
);
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099', '서울 강남구', 'Task4 Coach',
      '   ', 3, 'SPOLINK Bank', '1234', 'Task4 Applicant')$$,
  'P0001', 'VALIDATION_ERROR', 'bio must be trimmed nonempty text'
);
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099', '서울 강남구', 'Task4 Coach',
      repeat('b', 5001), 3, 'SPOLINK Bank', '1234', 'Task4 Applicant')$$,
  'P0001', 'VALIDATION_ERROR', 'bio maximum matches Zod limit 5000'
);
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099', '서울 강남구', 'Task4 Coach',
      'Task4 biography', 101, 'SPOLINK Bank', '1234', 'Task4 Applicant')$$,
  'P0001', 'VALIDATION_ERROR', 'career years maximum matches Zod limit 100'
);
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099', '서울 강남구', 'Task4 Coach',
      'Task4 biography', -1, 'SPOLINK Bank', '1234', 'Task4 Applicant')$$,
  'P0001', 'VALIDATION_ERROR', 'career years minimum matches Zod limit zero'
);
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099', '서울 강남구', 'Task4 Coach',
      'Task4 biography', 3, '   ', '1234', 'Task4 Applicant')$$,
  'P0001', 'VALIDATION_ERROR', 'bank name must be trimmed nonempty text'
);
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099', '서울 강남구', 'Task4 Coach',
      'Task4 biography', 3, repeat('k', 101), '1234', 'Task4 Applicant')$$,
  'P0001', 'VALIDATION_ERROR', 'bank name maximum matches Zod limit 100'
);
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099', '서울 강남구', 'Task4 Coach',
      'Task4 biography', 3, 'SPOLINK Bank', '1234', '   ')$$,
  'P0001', 'VALIDATION_ERROR', 'payout holder must be trimmed nonempty text'
);
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099', '서울 강남구', 'Task4 Coach',
      'Task4 biography', 3, 'SPOLINK Bank', '1234', repeat('p', 101))$$,
  'P0001', 'VALIDATION_ERROR', 'payout holder maximum matches Zod limit 100'
);
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099', '서울 강남구', 'Task4 Coach',
      'Task4 biography', 3, 'SPOLINK Bank', '12ab', 'Task4 Applicant')$$,
  'P0001', 'VALIDATION_ERROR', 'bank account last4 must be exactly four digits'
);
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000097', '서울 강남구', 'Task4 Coach',
      'Task4 biography', 3, 'SPOLINK Bank', '1234', 'Task4 Applicant')$$,
  'P0001', 'VALIDATION_ERROR', 'primary sport must exist'
);
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000098', '서울 강남구', 'Task4 Coach',
      'Task4 biography', 3, 'SPOLINK Bank', '1234', 'Task4 Applicant')$$,
  'P0001', 'VALIDATION_ERROR', 'primary sport must be active'
);
select throws_ok(
  $$update public.coach_profiles set headline = 'direct write'
    where user_id = '40000000-0000-4000-8000-000000000001'$$,
  '42501', 'permission denied for table coach_profiles',
  'authenticated direct coach profile mutation remains denied'
);
select throws_ok(
  $$update public.profiles set status = 'pending_coach'
    where id = '40000000-0000-4000-8000-000000000001'$$,
  '42501', 'Only trusted certification workflows can update profile status.',
  'authenticated cannot bypass the paired transition through a direct profile status update'
);
select results_eq(
  $$select p.status::text, cp.status::text
    from public.profiles p
    join public.coach_profiles cp on cp.user_id = p.id
    where p.id = '40000000-0000-4000-8000-000000000001'$$,
  $$values ('active', 'draft')$$,
  'rejected direct status update leaves both profile rows unchanged'
);
select lives_ok(
  $$update public.profiles set display_name = 'Ordinary profile edit'
    where id = '40000000-0000-4000-8000-000000000001'$$,
  'authenticated retains ordinary non-status profile updates'
);
select is(
  (select display_name from public.profiles
    where id = '40000000-0000-4000-8000-000000000001'),
  'Ordinary profile edit',
  'ordinary profile update persists'
);

select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099', E'\t\n', 'Task4 Coach',
      'Task4 biography', 3, 'SPOLINK Bank', '1234', 'Task4 Applicant')$$,
  'P0001', 'VALIDATION_ERROR', 'service region rejects JavaScript ASCII whitespace'
);
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099', '서울 강남구', U&'\00A0',
      'Task4 biography', 3, 'SPOLINK Bank', '1234', 'Task4 Applicant')$$,
  'P0001', 'VALIDATION_ERROR', 'headline rejects JavaScript NBSP whitespace'
);
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099', '서울 강남구', 'Task4 Coach',
      U&'\FEFF', 3, 'SPOLINK Bank', '1234', 'Task4 Applicant')$$,
  'P0001', 'VALIDATION_ERROR', 'bio rejects JavaScript BOM whitespace'
);
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099', '서울 강남구', 'Task4 Coach',
      'Task4 biography', 3, E'\t\n', '1234', 'Task4 Applicant')$$,
  'P0001', 'VALIDATION_ERROR', 'bank name rejects JavaScript ASCII whitespace'
);
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099', '서울 강남구', 'Task4 Coach',
      'Task4 biography', 3, 'SPOLINK Bank', '1234', U&'\00A0\FEFF')$$,
  'P0001', 'VALIDATION_ERROR', 'payout holder rejects JavaScript Unicode whitespace'
);
select lives_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099',
      U&'\00A0' || repeat('r', 98) || U&'\00A0',
      repeat('h', 118) || U&'\D83D\DE00',
      repeat('b', 4998) || U&'\D83D\DE00', 3,
      repeat('k', 98) || U&'\D83D\DE00', '1234',
      repeat('p', 98) || U&'\D83D\DE00')$$,
  'trimmed values at exact UTF-16 code-unit maxima are accepted'
);
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099',
      repeat('r', 99) || U&'\D83D\DE00', 'Task4 Coach',
      'Task4 biography', 3, 'SPOLINK Bank', '1234', 'Task4 Applicant')$$,
  'P0001', 'VALIDATION_ERROR', 'service region counts astral text as two UTF-16 code units'
);
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099', '서울 강남구',
      repeat('h', 119) || U&'\D83D\DE00', 'Task4 biography', 3,
      'SPOLINK Bank', '1234', 'Task4 Applicant')$$,
  'P0001', 'VALIDATION_ERROR', 'headline counts astral text as two UTF-16 code units'
);
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099', '서울 강남구', 'Task4 Coach',
      repeat('b', 4999) || U&'\D83D\DE00', 3, 'SPOLINK Bank', '1234',
      'Task4 Applicant')$$,
  'P0001', 'VALIDATION_ERROR', 'bio counts astral text as two UTF-16 code units'
);
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099', '서울 강남구', 'Task4 Coach',
      'Task4 biography', 3, repeat('k', 99) || U&'\D83D\DE00', '1234',
      'Task4 Applicant')$$,
  'P0001', 'VALIDATION_ERROR', 'bank name counts astral text as two UTF-16 code units'
);
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099', '서울 강남구', 'Task4 Coach',
      'Task4 biography', 3, 'SPOLINK Bank', '1234',
      repeat('p', 99) || U&'\D83D\DE00')$$,
  'P0001', 'VALIDATION_ERROR', 'payout holder counts astral text as two UTF-16 code units'
);
select results_eq(
  $$select status::text, headline
    from public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099', '서울 강남구', 'RPC saved coach',
      'RPC-owned draft biography', 6, 'SPOLINK Bank', '5678', 'Task4 Applicant'
    )$$,
  $$values ('draft', 'RPC saved coach')$$,
  'editable draft is saved through the auth-derived RPC'
);
select results_eq(
  $$select coach_status::text, profile_role::text, profile_status::text
    from public.submit_coach_application()$$,
  $$values ('submitted', 'learner', 'pending_coach')$$,
  'valid draft submission returns the exact submitted tuple'
);
reset role;
select is(
  (select status::text from public.coach_profiles where user_id = pg_temp.task4_id('valid')),
  'submitted',
  'valid submission changes coach state'
);
select is(
  (select status::text from public.profiles where id = pg_temp.task4_id('valid')),
  'pending_coach',
  'valid submission changes account state in the same transaction'
);

select pg_temp.set_task4_auth(pg_temp.task4_id('zero_cert'));
set local role authenticated;
select throws_ok(
  $$select public.submit_coach_application()$$,
  'P0001', 'COACH_CERTIFICATE_REQUIRED',
  'zero-certificate application is rejected'
);
reset role;
select is(
  (select cp.status::text || '/' || p.status::text
   from public.coach_profiles cp join public.profiles p on p.id = cp.user_id
   where cp.user_id = pg_temp.task4_id('zero_cert')),
  'draft/active',
  'zero-certificate rejection leaves no partial state'
);

select pg_temp.set_task4_auth(pg_temp.task4_id('incomplete'));
set local role authenticated;
select throws_ok(
  $$select public.submit_coach_application()$$,
  'P0001', 'COACH_APPLICATION_INCOMPLETE',
  'incomplete application is rejected'
);
reset role;
select is(
  (select cp.status::text || '/' || p.status::text
   from public.coach_profiles cp join public.profiles p on p.id = cp.user_id
   where cp.user_id = pg_temp.task4_id('incomplete')),
  'draft/active',
  'incomplete rejection leaves no partial state'
);

update storage.objects
set metadata = '{"mimetype":"text/plain","size":8}'::jsonb
where owner_id = pg_temp.task4_id('rejected')::text;
select pg_temp.set_task4_auth(pg_temp.task4_id('rejected'));
set local role authenticated;
select throws_ok(
  $$select public.submit_coach_application()$$,
  'P0001', 'COACH_CERTIFICATE_INVALID',
  'object and metadata mismatch is rejected'
);
reset role;
select is(
  (select cp.status::text || '/' || p.status::text
   from public.coach_profiles cp join public.profiles p on p.id = cp.user_id
   where cp.user_id = pg_temp.task4_id('rejected')),
  'rejected/active',
  'invalid object rejection preserves the prior tuple and review data'
);

select pg_temp.set_task4_auth(pg_temp.task4_id('submitted'));
set local role authenticated;
select throws_ok(
  $$select public.upsert_coach_application_draft(
      '40000000-0000-4000-8000-000000000099', '서울 강남구', 'forbidden edit',
      'submitted applications are immutable', 3, 'SPOLINK Bank', '1234', 'Task4 Applicant'
    )$$,
  'P0001', 'FORBIDDEN',
  'non-active submitted applicant cannot save a draft'
);
select throws_ok(
  $$select public.submit_coach_application()$$,
  'P0001', 'COACH_APPLICATION_CONFLICT',
  'submitted replay is rejected'
);
reset role;

select pg_temp.set_task4_auth(pg_temp.task4_id('approved'));
set local role authenticated;
select throws_ok(
  $$select public.submit_coach_application()$$,
  'P0001', 'COACH_APPLICATION_CONFLICT',
  'approved replay is rejected'
);
reset role;

select pg_temp.set_task4_auth(pg_temp.task4_id('suspended'));
set local role authenticated;
select throws_ok(
  $$select public.submit_coach_application()$$,
  'P0001', 'ACCOUNT_SUSPENDED',
  'suspended applicant is rejected before state transition'
);
reset role;

set local role anon;
select throws_ok(
  $$select public.submit_coach_application()$$,
  '42501', 'permission denied for function submit_coach_application',
  'anonymous execution is rejected'
);
reset role;

select * from finish();
rollback;
