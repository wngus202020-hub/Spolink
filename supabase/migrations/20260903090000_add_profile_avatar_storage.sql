insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  5 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile_avatar_objects_public_select" on storage.objects;
create policy "profile_avatar_objects_public_select"
on storage.objects
for select to public
using (bucket_id = 'profile-avatars');

drop policy if exists "profile_avatar_objects_owner_insert" on storage.objects;
create policy "profile_avatar_objects_owner_insert"
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'profile-avatars'
  and name ~ '^profiles/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/avatar$'
  and split_part(name, '/', 2) = (select auth.uid())::text
  and exists (
    select 1
    from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.deleted_at is null
      and profiles.status not in ('suspended', 'deleted')
  )
);

drop policy if exists "profile_avatar_objects_owner_update" on storage.objects;
create policy "profile_avatar_objects_owner_update"
on storage.objects
for update to authenticated
using (
  bucket_id = 'profile-avatars'
  and name ~ '^profiles/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/avatar$'
  and split_part(name, '/', 2) = (select auth.uid())::text
  and exists (
    select 1
    from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.deleted_at is null
      and profiles.status not in ('suspended', 'deleted')
  )
)
with check (
  bucket_id = 'profile-avatars'
  and name ~ '^profiles/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/avatar$'
  and split_part(name, '/', 2) = (select auth.uid())::text
);

drop policy if exists "profile_avatar_objects_owner_delete" on storage.objects;
create policy "profile_avatar_objects_owner_delete"
on storage.objects
for delete to authenticated
using (
  bucket_id = 'profile-avatars'
  and name ~ '^profiles/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/avatar$'
  and split_part(name, '/', 2) = (select auth.uid())::text
  and exists (
    select 1
    from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.deleted_at is null
      and profiles.status not in ('suspended', 'deleted')
  )
);
