begin;

create extension if not exists pgtap;

\ir lesson_images/setup.psql

select plan(138);

\ir lesson_images/schema.psql
\ir lesson_images/acl.psql
\ir lesson_images/rls.psql
\ir lesson_images/rpc.psql
\ir lesson_images/idempotency.psql
\ir lesson_images/concurrency.psql

select * from finish();

rollback;
