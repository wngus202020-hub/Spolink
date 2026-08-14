begin;

\ir reservation_cancellation/setup.psql

select plan(46);

\ir reservation_cancellation/structure_and_permissions.psql
\ir reservation_cancellation/learner_refunds.psql
\ir reservation_cancellation/coach_admin_refunds.psql
\ir reservation_cancellation/denials_pending_and_restore.psql

select * from finish();

rollback;
