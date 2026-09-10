begin;

create extension if not exists pgtap;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'withdraw-owner@example.test', '', statement_timestamp(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   statement_timestamp(), statement_timestamp()),
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'withdraw-foreign@example.test', '', statement_timestamp(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   statement_timestamp(), statement_timestamp());

insert into public.profiles (
  id, display_name, real_name, phone, avatar_path, default_region,
  marketing_agreed_at, location_agreed_at, role, status
) values
  ('91000000-0000-4000-8000-000000000001', '탈퇴 대상', '실명 정보', '010-1234-5678',
   'profiles/91000000-0000-4000-8000-000000000001/avatar', '서울 강남구',
   statement_timestamp(), statement_timestamp(), 'learner', 'active'),
  ('91000000-0000-4000-8000-000000000002', '다른 사용자', null, null, null, null,
   null, null, 'learner', 'active');

insert into public.notifications (user_id, type, title, data)
values (
  '91000000-0000-4000-8000-000000000001',
  'reservation_confirmed',
  '삭제할 알림',
  '{"reservationId":"91000000-0000-4000-8000-000000000011","paymentId":"91000000-0000-4000-8000-000000000012"}'::jsonb
);

insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
values (
  '91000000-0000-4000-8000-000000000001',
  'https://push.example.test/account-withdrawal', repeat('p', 87), repeat('a', 24)
);

create function pg_temp.set_withdrawal_actor(checked_actor uuid)
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', checked_actor, 'role', 'authenticated')::text, true);
  select set_config('request.jwt.claim.sub', checked_actor::text, true);
  select set_config('request.jwt.claim.role', 'authenticated', true);
$$;

select ok(
  has_function_privilege('authenticated', 'public.withdraw_current_account()', 'EXECUTE'),
  'authenticated sessions may withdraw only their current account'
);
select ok(
  not has_function_privilege('anon', 'public.withdraw_current_account()', 'EXECUTE'),
  'anonymous sessions cannot invoke account withdrawal'
);

select pg_temp.set_withdrawal_actor('91000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  (select account_id from public.withdraw_current_account()),
  '91000000-0000-4000-8000-000000000001'::uuid,
  'withdrawal derives the account from auth uid'
);
select is(
  (select idempotent from public.withdraw_current_account()),
  true,
  'repeated withdrawal is idempotent'
);
reset role;

select is(
  (select status::text from public.profiles where id = '91000000-0000-4000-8000-000000000001'),
  'deleted',
  'withdrawal disables the account immediately'
);
select results_eq(
  $$select display_name, real_name, phone, avatar_path, default_region,
           marketing_agreed_at, location_agreed_at
    from public.profiles where id = '91000000-0000-4000-8000-000000000001'$$,
  $$values ('탈퇴한 사용자'::text, null::text, null::text, null::text, null::text,
            null::timestamptz, null::timestamptz)$$,
  'withdrawal removes profile personal data'
);
select is(
  (select count(*)::integer from public.notifications
    where user_id = '91000000-0000-4000-8000-000000000001'),
  0,
  'withdrawal removes owner notifications'
);
select is(
  (select count(*)::integer from public.push_subscriptions
    where user_id = '91000000-0000-4000-8000-000000000001'),
  0,
  'withdrawal disables external notification delivery'
);
select is(
  (select count(*)::integer from public.audit_logs
    where actor_id = '91000000-0000-4000-8000-000000000001'
      and action = 'account.withdrawn'),
  1,
  'withdrawal records one audit event'
);
select is(
  (select status::text from public.profiles where id = '91000000-0000-4000-8000-000000000002'),
  'active',
  'withdrawal cannot target another account'
);

select * from finish();
rollback;
