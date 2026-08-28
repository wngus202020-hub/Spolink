drop function if exists public.register_lesson_image(uuid, text);

revoke all on table public.lesson_image_upload_intents from public, anon, authenticated, service_role;
revoke all on table public.lesson_image_deletion_receipts
  from public, anon, authenticated, service_role;
grant select on table public.lesson_image_upload_intents to authenticated;
revoke insert, update, delete on table public.lesson_images from public, anon, authenticated, service_role;
revoke truncate on table public.lesson_images from public, anon, authenticated, service_role;
revoke truncate on table public.lesson_image_upload_intents
  from public, anon, authenticated, service_role;
revoke truncate on table public.lesson_image_deletion_receipts
  from public, anon, authenticated, service_role;

revoke execute on function public.create_lesson_image_upload_intent(uuid, text, bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.cancel_lesson_image_upload_intent(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.register_validated_lesson_image(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.reorder_lesson_images(uuid, uuid[], uuid[])
  from public, anon, authenticated, service_role;
revoke execute on function public.begin_delete_lesson_image(uuid, uuid, uuid[])
  from public, anon, authenticated, service_role;
revoke execute on function public.finalize_delete_lesson_image(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.claim_expired_lesson_image_upload_intents(integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.finalize_lesson_image_upload_intent_cleanup(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

grant execute on function public.create_lesson_image_upload_intent(uuid, text, bigint)
  to authenticated;
grant execute on function public.cancel_lesson_image_upload_intent(uuid, uuid, text)
  to authenticated;
grant execute on function public.register_validated_lesson_image(uuid, uuid, text)
  to service_role;
grant execute on function public.reorder_lesson_images(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.begin_delete_lesson_image(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.finalize_delete_lesson_image(uuid, uuid) to authenticated;
grant execute on function public.claim_expired_lesson_image_upload_intents(integer)
  to service_role;
grant execute on function public.finalize_lesson_image_upload_intent_cleanup(uuid, uuid, boolean)
  to service_role;
