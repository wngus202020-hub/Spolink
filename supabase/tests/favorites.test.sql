begin;

create extension if not exists pgtap;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '81000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'favorite-one@example.test', '', statement_timestamp(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   statement_timestamp(), statement_timestamp()),
  ('00000000-0000-0000-0000-000000000000', '81000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'favorite-two@example.test', '', statement_timestamp(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   statement_timestamp(), statement_timestamp()),
  ('00000000-0000-0000-0000-000000000000', '81000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'favorite-coach@example.test', '', statement_timestamp(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   statement_timestamp(), statement_timestamp());

insert into public.profiles (id, display_name, role, status)
values
  ('81000000-0000-4000-8000-000000000001', 'Favorite learner one', 'learner', 'active'),
  ('81000000-0000-4000-8000-000000000002', 'Favorite learner two', 'learner', 'active'),
  ('81000000-0000-4000-8000-000000000003', 'Favorite coach', 'coach', 'coach_approved');

insert into public.sports (id, name, slug, is_active)
values ('81000000-0000-4000-8000-000000000010', 'Task4 Tennis', 'task4-tennis', true);

insert into public.coach_profiles (id, user_id, status, service_region)
values (
  '82000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000003',
  'approved',
  '서울'
);

insert into public.lessons (
  id, coach_profile_id, sport_id, status, title, description, region,
  duration_minutes, price_amount, capacity
) values
  ('83000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
   '81000000-0000-4000-8000-000000000010', 'active', 'Favorite active lesson',
   'Active favorite fixture', '서울', 60, 10000, 2),
  ('83000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001',
   '81000000-0000-4000-8000-000000000010', 'paused', 'Favorite paused lesson',
   'Paused favorite fixture', '서울', 60, 10000, 2);

create function pg_temp.set_favorite_actor(checked_actor uuid)
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', checked_actor, 'role', 'authenticated')::text, true);
  select set_config('request.jwt.claim.sub', checked_actor::text, true);
  select set_config('request.jwt.claim.role', 'authenticated', true);
$$;

select ok(
  has_function_privilege('authenticated', 'public.add_lesson_favorite(uuid)', 'EXECUTE'),
  'authenticated sessions may invoke favorite add'
);
select ok(
  not has_function_privilege('anon', 'public.add_lesson_favorite(uuid)', 'EXECUTE'),
  'anonymous sessions cannot invoke favorite add'
);
select ok(
  not has_table_privilege('authenticated', 'public.lesson_favorites', 'INSERT,UPDATE,DELETE'),
  'authenticated sessions cannot write the favorite table directly'
);
select ok(
  has_table_privilege('authenticated', 'public.lesson_favorites', 'SELECT'),
  'authenticated sessions retain the owner read model'
);

select pg_temp.set_favorite_actor('81000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  (select favorite_added from public.add_lesson_favorite(
    '83000000-0000-4000-8000-000000000001')),
  true,
  'first add creates the owner favorite'
);
select is(
  (select favorite_added from public.add_lesson_favorite(
    '83000000-0000-4000-8000-000000000001')),
  false,
  'duplicate add is an idempotent replay'
);
select throws_ok(
  $$select public.add_lesson_favorite('83000000-0000-4000-8000-000000000002')$$,
  'P0001', 'FAVORITE_LESSON_NOT_ACTIVE',
  'inactive lessons cannot be added'
);
reset role;

select pg_temp.set_favorite_actor('81000000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  (select favorite_added from public.add_lesson_favorite(
    '83000000-0000-4000-8000-000000000001')),
  true,
  'another learner owns an independent favorite for the same lesson'
);
select is(
  (select count(*)::integer from public.lesson_favorites),
  1,
  'RLS exposes only the current learner favorite'
);
reset role;

select pg_temp.set_favorite_actor('81000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  (select favorite_removed from public.remove_lesson_favorite(
    '83000000-0000-4000-8000-000000000001')),
  true,
  'owner remove deletes exactly one favorite'
);
select is(
  (select favorite_removed from public.remove_lesson_favorite(
    '83000000-0000-4000-8000-000000000001')),
  false,
  'repeated remove is an idempotent replay'
);
reset role;

select pg_temp.set_favorite_actor('81000000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$select public.add_lesson_favorite('83000000-0000-4000-8000-000000000001')$$,
  'P0001', 'FAVORITE_FORBIDDEN',
  'a coach role cannot bypass the learner-owned RPC'
);
reset role;

select * from finish();
rollback;
