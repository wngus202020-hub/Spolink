begin;
select plan(16);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '7a000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'push-a@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-8000-000000000000', '7a000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'push-b@test.invalid', '', now(), '{}', '{}', now(), now());

insert into public.profiles (id, display_name, role, status) values
  ('7a000000-0000-4000-8000-000000000001', 'Push A', 'learner', 'active'),
  ('7a000000-0000-4000-8000-000000000002', 'Push B', 'learner', 'active');

select ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ),
  'notifications are published to Supabase Realtime'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.upsert_push_subscription(text,text,text,timestamptz)',
    'EXECUTE'
  ),
  'authenticated users can call the scoped subscription RPC'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_notification_push_deliveries(integer)',
    'EXECUTE'
  ),
  'authenticated users cannot claim push deliveries'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.claim_notification_push_deliveries(integer)',
    'EXECUTE'
  ),
  'service role can claim push deliveries'
);
select ok(
  not has_table_privilege('authenticated', 'public.notification_push_deliveries', 'SELECT'),
  'delivery outbox is private from authenticated users'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"7a000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select set_config('request.jwt.claim.sub', '7a000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  public.upsert_push_subscription(
    'https://push.example.test/subscriptions/device-a',
    repeat('B', 87),
    repeat('A', 24),
    null
  ),
  true,
  'owner can register a valid subscription'
);
select is(
  public.disable_push_subscription('https://push.example.test/subscriptions/device-b'),
  false,
  'owner cannot disable another endpoint'
);
select throws_ok(
  $$select * from public.claim_notification_push_deliveries(10)$$,
  '42501',
  null,
  'ordinary user cannot invoke the trusted claim RPC'
);

reset role;
insert into public.notifications (id, user_id, type, title, body, data, event_key)
values (
  '7a100000-0000-4000-8000-000000000001',
  '7a000000-0000-4000-8000-000000000001',
  'reservation_confirmed',
  '예약 확정',
  '예약이 확정되었습니다.',
  '{"reservationId":"7a100000-0000-4000-8000-000000000001","paymentId":"7a100000-0000-4000-8000-000000000002"}',
  'push:test:1'
);

select is(
  (select count(*)::integer from public.notification_push_deliveries),
  1,
  'notification insert enqueues one delivery per active subscription'
);

create temporary table push_claim on commit drop as
select * from public.claim_notification_push_deliveries(10);
select is((select count(*)::integer from push_claim), 1, 'worker claims one due delivery');
select is((select attempt from push_claim), 1, 'first claim records attempt one');
select is(
  (select status::text from public.notification_push_deliveries),
  'processing',
  'claimed delivery is processing'
);

select is(
  (
    select status::text
    from public.record_notification_push_delivery_result(
      (select delivery_id from push_claim),
      (select claim_token from push_claim),
      'expired',
      'PUSH_SUBSCRIPTION_EXPIRED'
    )
  ),
  'dead',
  'expired provider result closes the delivery'
);
select ok(
  (select disabled_at is not null from public.push_subscriptions),
  'expired provider result disables the subscription'
);
select is(
  (
    select status::text
    from public.record_notification_push_delivery_result(
      (select delivery_id from push_claim),
      (select claim_token from push_claim),
      'expired',
      'PUSH_SUBSCRIPTION_EXPIRED'
    )
  ),
  'dead',
  'same terminal result replay is idempotent'
);
select throws_ok(
  format(
    'select * from public.record_notification_push_delivery_result(%L, %L, %L, null)',
    (select delivery_id from push_claim),
    (select claim_token from push_claim),
    'delivered'
  ),
  '23505',
  'Conflicting push delivery result.',
  'opposite terminal result conflicts'
);

select * from finish();
rollback;
