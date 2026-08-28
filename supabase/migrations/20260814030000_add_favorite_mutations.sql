alter table public.lesson_favorites
  rename constraint lesson_favorites_learner_id_lesson_id_key
  to lesson_favorites_learner_lesson_unique;

drop policy if exists "lesson_favorites_owner_all" on public.lesson_favorites;

alter table public.lesson_favorites enable row level security;
alter table public.lesson_favorites force row level security;

revoke all on table public.lesson_favorites from public, anon, authenticated;
grant select on table public.lesson_favorites to authenticated;

create policy "lesson_favorites_owner_select" on public.lesson_favorites
  for select to authenticated
  using (learner_id = (select auth.uid()));

create or replace function public.add_lesson_favorite(checked_lesson_id uuid)
returns table (
  lesson_id uuid,
  favorite_added boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting_id uuid := auth.uid();
  acting_profile public.profiles%rowtype;
  inserted_count integer;
begin
  if acting_id is null then
    raise exception 'FAVORITE_UNAUTHORIZED' using errcode = 'P0001';
  end if;

  select * into acting_profile
  from public.profiles
  where id = acting_id;

  if not found then
    raise exception 'FAVORITE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;

  if acting_profile.role <> 'learner' then
    raise exception 'FAVORITE_FORBIDDEN' using errcode = 'P0001';
  end if;

  if acting_profile.status = 'suspended' then
    raise exception 'FAVORITE_ACCOUNT_SUSPENDED' using errcode = 'P0001';
  end if;

  if acting_profile.status = 'deleted' or acting_profile.deleted_at is not null then
    raise exception 'FAVORITE_ACCOUNT_DELETED' using errcode = 'P0001';
  end if;

  perform 1
  from public.lessons
  where id = checked_lesson_id
    and status = 'active';

  if not found then
    raise exception 'FAVORITE_LESSON_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  insert into public.lesson_favorites (learner_id, lesson_id)
  values (acting_id, checked_lesson_id)
  on conflict on constraint lesson_favorites_learner_lesson_unique do nothing;

  get diagnostics inserted_count = row_count;

  return query select checked_lesson_id, inserted_count = 1;
end;
$$;

create or replace function public.remove_lesson_favorite(checked_lesson_id uuid)
returns table (
  lesson_id uuid,
  favorite_removed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting_id uuid := auth.uid();
  acting_profile public.profiles%rowtype;
  deleted_count integer;
begin
  if acting_id is null then
    raise exception 'FAVORITE_UNAUTHORIZED' using errcode = 'P0001';
  end if;

  select * into acting_profile
  from public.profiles
  where id = acting_id;

  if not found then
    raise exception 'FAVORITE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;

  if acting_profile.role <> 'learner' then
    raise exception 'FAVORITE_FORBIDDEN' using errcode = 'P0001';
  end if;

  if acting_profile.status = 'suspended' then
    raise exception 'FAVORITE_ACCOUNT_SUSPENDED' using errcode = 'P0001';
  end if;

  if acting_profile.status = 'deleted' or acting_profile.deleted_at is not null then
    raise exception 'FAVORITE_ACCOUNT_DELETED' using errcode = 'P0001';
  end if;

  delete from public.lesson_favorites
  where learner_id = acting_id
    and lesson_favorites.lesson_id = checked_lesson_id;

  get diagnostics deleted_count = row_count;

  return query select checked_lesson_id, deleted_count = 1;
end;
$$;

revoke all on function public.add_lesson_favorite(uuid) from public, anon, authenticated;
revoke all on function public.remove_lesson_favorite(uuid) from public, anon, authenticated;
grant execute on function public.add_lesson_favorite(uuid) to authenticated;
grant execute on function public.remove_lesson_favorite(uuid) to authenticated;
