drop policy if exists "lesson_image_upload_intents_owner_select"
  on public.lesson_image_upload_intents;
create policy "lesson_image_upload_intents_owner_select"
on public.lesson_image_upload_intents
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "lesson_images_public_select" on public.lesson_images;
drop policy if exists "lesson_images_owner_all" on public.lesson_images;
drop policy if exists "lesson_images_ready_select" on public.lesson_images;
create policy "lesson_images_ready_select"
on public.lesson_images
for select to anon, authenticated
using (
  lifecycle_state = 'ready'
  and (
    public.lesson_is_public(lesson_id)
    or public.owns_lesson(lesson_id)
    or public.is_admin()
  )
);

drop policy if exists "lesson_image_objects_public_select" on storage.objects;
create policy "lesson_image_objects_public_select"
on storage.objects
for select to public
using (bucket_id = 'lesson-images');

drop policy if exists "lesson_image_objects_intent_insert" on storage.objects;
create policy "lesson_image_objects_intent_insert"
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'lesson-images'
  and exists (
    select 1
    from public.lesson_image_upload_intents intent
    join public.lessons lesson on lesson.id = intent.lesson_id
    join public.coach_profiles coach on coach.id = intent.coach_profile_id
    where intent.object_name = storage.objects.name
      and intent.user_id = (select auth.uid())
      and intent.status = 'pending'
      and intent.expires_at > statement_timestamp()
      and lesson.coach_profile_id = intent.coach_profile_id
      and lesson.status in ('draft', 'rejected')
      and coach.user_id = (select auth.uid())
      and coach.status = 'approved'
  )
);

drop policy if exists "lesson_image_objects_intent_update" on storage.objects;

drop policy if exists "lesson_image_objects_intent_delete" on storage.objects;
create policy "lesson_image_objects_intent_delete"
on storage.objects
for delete to authenticated
using (
  bucket_id = 'lesson-images'
  and exists (
    select 1
    from public.lesson_image_upload_intents intent
    join public.lessons lesson on lesson.id = intent.lesson_id
    join public.coach_profiles coach on coach.id = intent.coach_profile_id
    where intent.object_name = storage.objects.name
      and intent.user_id = (select auth.uid())
      and intent.status = 'pending'
      and intent.expires_at > statement_timestamp()
      and lesson.coach_profile_id = intent.coach_profile_id
      and lesson.status in ('draft', 'rejected')
      and coach.user_id = (select auth.uid())
      and coach.status = 'approved'
  )
);
