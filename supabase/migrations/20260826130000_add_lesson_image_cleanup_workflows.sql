create or replace function public.claim_expired_lesson_image_upload_intents(
  checked_limit integer default 25
)
returns setof public.lesson_image_upload_intents
language plpgsql
security definer
set search_path = public
as $$
begin
  if checked_limit is null or checked_limit not between 1 and 100 then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  return query
  with candidates as (
    select id
    from public.lesson_image_upload_intents
    where (status = 'pending' and expires_at <= statement_timestamp())
      or (status = 'claimed' and claimed_at <= statement_timestamp() - interval '5 minutes')
    order by expires_at, created_at, id
    for update skip locked
    limit checked_limit
  )
  update public.lesson_image_upload_intents intent
  set status = 'claimed',
      claim_token = gen_random_uuid(),
      claimed_at = statement_timestamp(),
      updated_at = statement_timestamp()
  from candidates
  where intent.id = candidates.id
  returning intent.*;
end;
$$;

create or replace function public.finalize_lesson_image_upload_intent_cleanup(
  checked_intent_id uuid,
  checked_claim_token uuid,
  checked_cleaned boolean
)
returns setof public.lesson_image_upload_intents
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_intent public.lesson_image_upload_intents;
begin
  if checked_cleaned is null then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  select * into selected_intent
  from public.lesson_image_upload_intents
  where id = checked_intent_id
  for update;
  if not found then
    return;
  end if;
  if selected_intent.status = 'cleaned'
    and selected_intent.claim_token = checked_claim_token then
    return next selected_intent;
    return;
  end if;
  if selected_intent.status <> 'claimed'
    or selected_intent.claim_token <> checked_claim_token then
    raise exception 'STALE_IMAGE_INTENT_CLAIM' using errcode = 'P0001';
  end if;

  if checked_cleaned then
    update public.lesson_image_upload_intents
    set status = 'cleaned', completed_at = statement_timestamp(), updated_at = statement_timestamp()
    where id = checked_intent_id returning * into selected_intent;
  else
    update public.lesson_image_upload_intents
    set status = 'pending', claim_token = null, claimed_at = null,
        expires_at = statement_timestamp(), updated_at = statement_timestamp()
    where id = checked_intent_id returning * into selected_intent;
  end if;
  return next selected_intent;
end;
$$;
