create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table if not exists private.password_recovery_grants (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null check (char_length(session_id) between 1 and 255),
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  created_at timestamptz not null default statement_timestamp(),
  check (expires_at > created_at and expires_at <= created_at + interval '600 seconds'),
  check (consumed_at is null or consumed_at >= created_at)
);

create index if not exists password_recovery_grants_active_user_session_idx
  on private.password_recovery_grants (user_id, session_id, expires_at)
  where consumed_at is null;

alter table private.password_recovery_grants enable row level security;

revoke all privileges on private.password_recovery_grants from public, anon, authenticated;
revoke all privileges on all sequences in schema private from public, anon, authenticated;

create or replace function public.issue_password_recovery_grant(
  checked_token_hash text,
  checked_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  checked_user_id uuid := auth.uid();
  checked_session_id text := nullif(auth.jwt()->>'session_id','');
  checked_now timestamptz := statement_timestamp();
  inserted_count integer := 0;
begin
  if checked_user_id is null or checked_session_id is null then
    return false;
  end if;

  if checked_token_hash !~ '^[a-f0-9]{64}$' then
    return false;
  end if;

  if checked_expires_at <= checked_now or checked_expires_at > checked_now + interval '600 seconds' then
    return false;
  end if;

  insert into private.password_recovery_grants (
    token_hash,
    user_id,
    session_id,
    expires_at
  )
  values (
    checked_token_hash,
    checked_user_id,
    checked_session_id,
    checked_expires_at
  )
  on conflict (token_hash) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count = 1;
end;
$$;

create or replace function public.consume_password_recovery_grant(
  checked_token_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  checked_user_id uuid := auth.uid();
  checked_session_id text := nullif(auth.jwt()->>'session_id','');
  updated_count integer := 0;
begin
  if checked_user_id is null or checked_session_id is null then
    return false;
  end if;

  if checked_token_hash !~ '^[a-f0-9]{64}$' then
    return false;
  end if;

  update private.password_recovery_grants
  set consumed_at = statement_timestamp()
  where token_hash = checked_token_hash
    and user_id = checked_user_id
    and session_id = checked_session_id
    and consumed_at is null
    and expires_at > statement_timestamp();

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

revoke execute on function public.issue_password_recovery_grant(text, timestamptz) from public, anon;
revoke execute on function public.consume_password_recovery_grant(text) from public, anon;
grant execute on function public.issue_password_recovery_grant(text, timestamptz) to authenticated;
grant execute on function public.consume_password_recovery_grant(text) to authenticated;
