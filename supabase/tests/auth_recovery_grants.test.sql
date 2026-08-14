begin;

create extension if not exists pgtap;

\ir auth_recovery_grants/setup.psql

select no_plan();

\ir auth_recovery_grants/structure_and_permissions.psql
\ir auth_recovery_grants/behavior.psql

select * from finish();

rollback;
