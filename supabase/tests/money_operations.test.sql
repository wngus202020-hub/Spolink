begin;

\ir reservation_cancellation/setup.psql

select plan(23);
set local role postgres;

insert into public.refunds (
  id, payment_id, reservation_id, requested_by, amount, reason, source
) values (
  '00000000-0000-4000-8000-000000000701',
  '00000000-0000-4000-8000-000000000502',
  '00000000-0000-4000-8000-000000000402',
  '00000000-0000-4000-8000-000000000901',
  6000, 'Task8 refund', 'manual'
);
select is((select sum(amount) from public.refunds where payment_id = '00000000-0000-4000-8000-000000000502'), 6000::bigint, 'refund total starts below original payment');
select (select claim_token is not null from public.claim_refund('00000000-0000-4000-8000-000000000701', 'task8-attempt-1'));
select is((select attempt from public.claim_refund('00000000-0000-4000-8000-000000000701', 'task8-attempt-1')), 1, 'claim replay is idempotent');
select is((select status::text from public.process_refund_result('00000000-0000-4000-8000-000000000701', 'fail', null, 'TIMEOUT', '{"provider":"local"}', (select claim_token from public.refunds where id = '00000000-0000-4000-8000-000000000701'))), 'failed', 'timeout records deterministic failure');
select is((select idempotent from public.process_refund_result('00000000-0000-4000-8000-000000000701', 'fail', null, 'TIMEOUT', '{"provider":"local"}', null)), true, 'failure replay is idempotent');
select throws_ok($$select public.process_refund_result('00000000-0000-4000-8000-000000000701', 'complete', 'provider-conflict', null, null, null)$$, '23505', 'Conflicting refund provider result.', 'opposite provider result is rejected');
select throws_ok($$insert into public.refunds (payment_id, reservation_id, requested_by, amount, reason, source) values ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000901', 11000, 'over', 'manual')$$, '22003', 'Refund amount exceeds the original payment.', 'refund amount cannot exceed payment');

update public.payments set amount = 5000 where id = '00000000-0000-4000-8000-000000000501';
select throws_ok($$update public.refunds set payment_id = '00000000-0000-4000-8000-000000000501' where id = '00000000-0000-4000-8000-000000000701'$$, '22003', 'Refund amount exceeds the original payment.', 'payment reassignment validates the written payment principal');
select is((select payment_id from public.refunds where id = '00000000-0000-4000-8000-000000000701'), '00000000-0000-4000-8000-000000000502'::uuid, 'failed payment reassignment rolls back');

select is((select provider_refund_key from public.refunds where id = '00000000-0000-4000-8000-000000000701'), null::text, 'failed result has no provider key');
select is((select status::text from public.claim_refund('00000000-0000-4000-8000-000000000701', 'task8-attempt-2')), 'failed', 'terminal claim cannot return to approved');
select is((select last_failure_code from public.refunds where id = '00000000-0000-4000-8000-000000000701'), 'TIMEOUT', 'terminal claim preserves failure result');
select ok((select processed_at is not null from public.refunds where id = '00000000-0000-4000-8000-000000000701'), 'terminal claim preserves provider timestamp');

insert into public.refunds (
  id, payment_id, reservation_id, requested_by, amount, reason, source
) values (
  '00000000-0000-4000-8000-000000000702',
  '00000000-0000-4000-8000-000000000502',
  '00000000-0000-4000-8000-000000000402',
  '00000000-0000-4000-8000-000000000901',
  1000, 'Task8 completed terminal', 'manual'
);
select claim_token is not null from public.claim_refund('00000000-0000-4000-8000-000000000702', 'task8-complete-1');
select is((select status::text from public.process_refund_result('00000000-0000-4000-8000-000000000702', 'complete', 'provider-complete', null, '{"provider":"local"}', (select claim_token from public.refunds where id = '00000000-0000-4000-8000-000000000702'))), 'completed', 'provider completion records terminal state');
select is((select status::text from public.claim_refund('00000000-0000-4000-8000-000000000702', 'task8-complete-2')), 'completed', 'completed claim cannot return to approved');
select is((select provider_refund_key from public.refunds where id = '00000000-0000-4000-8000-000000000702'), 'provider-complete', 'completed claim preserves provider result');

update public.reservations set status = 'completed', completed_at = now() where id = '00000000-0000-4000-8000-000000000402';
select throws_ok($$select public.generate_settlement('00000000-0000-4000-8000-000000000402')$$, 'P0001', 'Reservation is not eligible for settlement.', 'settlement observes the refund and dispute hold period');
update public.reservations set completed_at = now() - interval '24 hours' where id = '00000000-0000-4000-8000-000000000402';
select is((select status::text from public.generate_settlement('00000000-0000-4000-8000-000000000402')), 'pending', 'completed eligible reservation generates pending settlement');
select is((select idempotent from public.generate_settlement('00000000-0000-4000-8000-000000000402')), true, 'settlement generation is duplicate safe');
select is((select status::text from public.set_settlement_status((select id from public.settlements where reservation_id = '00000000-0000-4000-8000-000000000402'), 'hold', 'manual review')), 'hold', 'admin hold is audited state');
select is((select idempotent from public.set_settlement_status((select id from public.settlements where reservation_id = '00000000-0000-4000-8000-000000000402'), 'hold', 'manual review')), true, 'hold replay is idempotent');
select is((select status::text from public.set_settlement_status((select id from public.settlements where reservation_id = '00000000-0000-4000-8000-000000000402'), 'approve', null)), 'approved', 'approve is allowed from hold');
select throws_ok($$update public.settlements set status = 'paid' where reservation_id = '00000000-0000-4000-8000-000000000402'$$, '23514', null, 'paid payout state is blocked');
select ok(not has_table_privilege('authenticated', 'public.settlements', 'INSERT,UPDATE,DELETE'), 'authenticated direct settlement writes are denied');

select * from finish();
rollback;
