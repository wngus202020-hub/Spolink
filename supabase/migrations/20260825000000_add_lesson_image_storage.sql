insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lesson-images',
  'lesson-images',
  true,
  5 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if exists (
    select 1
    from public.lesson_images
    where file_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
      or split_part(file_path, '/', 1) <> lesson_id::text
      or sort_order not between 0 and 4
  ) then
    raise exception 'Existing lesson image rows violate the canonical path or sort range.';
  end if;

  if exists (
    select file_path from public.lesson_images group by file_path having count(*) > 1
  ) or exists (
    select lesson_id, sort_order
    from public.lesson_images
    group by lesson_id, sort_order
    having count(*) > 1
  ) then
    raise exception 'Existing lesson image rows contain duplicate paths or sort positions.';
  end if;
end;
$$;

alter table public.lesson_images
  add column lifecycle_state text not null default 'ready';

alter table public.lesson_images
  add constraint lesson_images_lifecycle_state_check
    check (lifecycle_state in ('ready', 'deleting')),
  add constraint lesson_images_file_path_canonical_check
    check (
      file_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
      and split_part(file_path, '/', 1) = lesson_id::text
    ),
  add constraint lesson_images_sort_order_range_check check (sort_order between 0 and 4),
  add constraint lesson_images_file_path_key unique (file_path),
  add constraint lesson_images_lesson_sort_key
    unique (lesson_id, sort_order) deferrable initially immediate;

create table public.lesson_image_upload_intents (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  coach_profile_id uuid not null references public.coach_profiles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  object_name text not null unique,
  mime_type text not null,
  size_bytes bigint not null,
  status text not null default 'pending',
  registered_image_id uuid unique,
  claim_token uuid,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default (statement_timestamp() + interval '2 hours'),
  constraint lesson_image_upload_intents_mime_type_check
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint lesson_image_upload_intents_size_bytes_check
    check (size_bytes between 1 and 5242880),
  constraint lesson_image_upload_intents_status_check
    check (status in ('pending', 'claimed', 'registered', 'cleaned', 'cancelled')),
  constraint lesson_image_upload_intents_object_name_check
    check (
      object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
      and split_part(object_name, '/', 1) = lesson_id::text
      and (
        (mime_type = 'image/jpeg' and right(object_name, 4) = '.jpg')
        or (mime_type = 'image/png' and right(object_name, 4) = '.png')
        or (mime_type = 'image/webp' and right(object_name, 5) = '.webp')
      )
    ),
  constraint lesson_image_upload_intents_claim_shape_check
    check (
      (status = 'claimed' and claim_token is not null and claimed_at is not null)
      or (status in ('pending', 'registered', 'cancelled')
        and claim_token is null and claimed_at is null)
      or (status = 'cleaned' and claim_token is not null and claimed_at is not null)
    ),
  constraint lesson_image_upload_intents_completion_shape_check
    check (
      (status in ('registered', 'cleaned', 'cancelled') and completed_at is not null)
      or (status in ('pending', 'claimed') and completed_at is null)
    ),
  constraint lesson_image_upload_intents_registered_image_shape_check
    check (
      (status = 'registered' and registered_image_id is not null)
      or (status <> 'registered' and registered_image_id is null)
    )
);

create table public.lesson_image_deletion_receipts (
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  image_id uuid not null,
  coach_profile_id uuid not null references public.coach_profiles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  file_path text not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (lesson_id, image_id),
  constraint lesson_image_deletion_receipts_file_path_check
    check (
      file_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
      and split_part(file_path, '/', 1) = lesson_id::text
    )
);

create index lesson_image_upload_intents_lesson_active_idx
  on public.lesson_image_upload_intents (lesson_id, expires_at)
  where status = 'pending';
create index lesson_image_upload_intents_expiry_idx
  on public.lesson_image_upload_intents (expires_at, created_at)
  where status = 'pending';

alter table public.lesson_image_upload_intents enable row level security;
alter table public.lesson_image_deletion_receipts enable row level security;
