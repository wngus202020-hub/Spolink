insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'coach-certificates',
  'coach-certificates',
  false,
  10 * 1024 * 1024,
  array['image/png', 'image/jpeg', 'application/pdf']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.coach_certificates
  add constraint coach_certificates_file_path_object_name_check
  check (
    file_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|pdf)$'
  );

create or replace function public.protect_coach_certificate_storage_fields()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  certificate_owner_id uuid;
begin
  select coach_profiles.user_id
  into certificate_owner_id
  from public.coach_profiles
  where coach_profiles.id = new.coach_profile_id;

  if certificate_owner_id is null
    or split_part(new.file_path, '/', 1) <> certificate_owner_id::text then
    raise exception 'Certificate object ownership does not match the coach profile.'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
    and old.file_path is distinct from new.file_path
    and not public.is_admin() then
    raise exception 'Certificate object names cannot be changed by applicants.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger coach_certificates_protect_storage_fields
before insert or update on public.coach_certificates
for each row execute function public.protect_coach_certificate_storage_fields();

drop policy "coach_certificates_insert_owner" on public.coach_certificates;
create policy "coach_certificates_insert_owner_draft" on public.coach_certificates
  for insert to authenticated
  with check (
    public.owns_coach_profile(coach_profile_id)
    and verified_at is null
    and rejected_reason is null
    and exists (
      select 1
      from public.coach_profiles
      where coach_profiles.id = coach_certificates.coach_profile_id
        and coach_profiles.status in ('draft', 'rejected')
    )
  );

drop policy "coach_certificates_update_owner_or_admin" on public.coach_certificates;
create policy "coach_certificates_update_owner_draft_or_admin" on public.coach_certificates
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.owns_coach_profile(coach_profile_id)
      and exists (
        select 1
        from public.coach_profiles
        where coach_profiles.id = coach_certificates.coach_profile_id
          and coach_profiles.status in ('draft', 'rejected')
      )
    )
  )
  with check (
    public.is_admin()
    or (
      public.owns_coach_profile(coach_profile_id)
      and exists (
        select 1
        from public.coach_profiles
        where coach_profiles.id = coach_certificates.coach_profile_id
          and coach_profiles.status in ('draft', 'rejected')
      )
    )
  );

create policy "coach_certificates_delete_owner_draft" on public.coach_certificates
  for delete to authenticated
  using (
    public.owns_coach_profile(coach_profile_id)
    and exists (
      select 1
      from public.coach_profiles
      where coach_profiles.id = coach_certificates.coach_profile_id
        and coach_profiles.status in ('draft', 'rejected')
    )
  );

create policy "coach_certificate_objects_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'coach-certificates'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|pdf)$'
    and split_part(name, '/', 1) = (select auth.uid())::text
    and exists (
      select 1
      from public.profiles
      join public.coach_profiles on coach_profiles.user_id = profiles.id
      where profiles.id = (select auth.uid())
        and profiles.role = 'learner'
        and profiles.status = 'active'
        and coach_profiles.status in ('draft', 'rejected')
    )
  );

create policy "coach_certificate_objects_owner_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'coach-certificates'
    and split_part(name, '/', 1) = (select auth.uid())::text
  );

create policy "coach_certificate_objects_owner_delete_draft" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'coach-certificates'
    and split_part(name, '/', 1) = (select auth.uid())::text
    and exists (
      select 1
      from public.coach_certificates
      join public.coach_profiles
        on coach_profiles.id = coach_certificates.coach_profile_id
      where coach_certificates.file_path = storage.objects.name
        and coach_profiles.user_id = (select auth.uid())
        and coach_profiles.status in ('draft', 'rejected')
    )
  );
