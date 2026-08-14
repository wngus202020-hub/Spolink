alter table public.coach_profiles
  add constraint coach_profiles_rejection_reason_bounded_check
  check (
    status <> 'rejected'
    or (
      rejection_reason is not null
      and char_length(btrim(rejection_reason)) between 1 and 1000
    )
  );

create unique index coach_certification_review_audit_once_idx
on public.audit_logs (target_id, ((after_data ->> 'submittedAt')))
where target_type = 'coach_profile'
  and action in ('coach_certification.approved', 'coach_certification.rejected');

create unique index coach_certification_review_notification_once_idx
on public.notifications (
  user_id,
  ((data ->> 'coachProfileId')),
  ((data ->> 'submittedAt'))
)
where type = 'coach_certification.reviewed';

create policy "coach_certificate_objects_admin_select" on storage.objects
for select to authenticated
using (
  bucket_id = 'coach-certificates'
  and public.is_admin()
);

create or replace function public.review_coach_application(
  checked_coach_profile_id uuid,
  checked_decision text,
  checked_rejection_reason text default null
)
returns table (
  coach_profile_id uuid,
  coach_status public.coach_status,
  profile_status public.user_status,
  reviewed_at timestamptz,
  idempotent boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_admin public.profiles%rowtype;
  selected_coach public.coach_profiles%rowtype;
  selected_profile public.profiles%rowtype;
  normalized_reason text;
  target_coach_status public.coach_status;
  target_profile_status public.user_status;
  review_action text;
  review_title text;
  review_body text;
  review_time timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select profiles.*
  into acting_admin
  from public.profiles
  where profiles.id = (select auth.uid())
  for update;

  if not found
    or acting_admin.role <> 'admin'
    or acting_admin.status <> 'active'
    or acting_admin.deleted_at is not null then
    raise exception 'FORBIDDEN';
  end if;

  if checked_decision not in ('approve', 'reject') then
    raise exception 'VALIDATION_ERROR';
  end if;

  normalized_reason := nullif(btrim(checked_rejection_reason), '');
  if checked_decision = 'reject'
    and (normalized_reason is null or char_length(normalized_reason) > 1000) then
    raise exception 'VALIDATION_ERROR';
  end if;
  if checked_decision = 'approve' and checked_rejection_reason is not null then
    raise exception 'VALIDATION_ERROR';
  end if;

  select coach_profiles.*
  into selected_coach
  from public.coach_profiles
  where coach_profiles.id = checked_coach_profile_id
  for update;

  if not found then
    raise exception 'COACH_APPLICATION_NOT_FOUND';
  end if;

  select profiles.*
  into selected_profile
  from public.profiles
  where profiles.id = selected_coach.user_id
  for update;

  if not found or selected_profile.role <> 'learner' then
    raise exception 'COACH_APPLICATION_CONFLICT';
  end if;

  if selected_coach.status = 'approved'
    and checked_decision = 'approve'
    and selected_profile.status = 'coach_approved' then
    return query select
      selected_coach.id,
      selected_coach.status,
      selected_profile.status,
      selected_coach.reviewed_at,
      true;
    return;
  end if;

  if selected_coach.status = 'rejected'
    and checked_decision = 'reject'
    and selected_profile.status = 'active' then
    return query select
      selected_coach.id,
      selected_coach.status,
      selected_profile.status,
      selected_coach.reviewed_at,
      true;
    return;
  end if;

  if selected_coach.status <> 'submitted' or selected_profile.status <> 'pending_coach' then
    raise exception 'COACH_APPLICATION_CONFLICT';
  end if;

  if checked_decision = 'approve' then
    target_coach_status := 'approved';
    target_profile_status := 'coach_approved';
    review_action := 'coach_certification.approved';
    review_title := '지도자 인증이 승인되었어요';
    review_body := 'SPOLINK 지도자 활동을 시작할 수 있어요.';
  else
    target_coach_status := 'rejected';
    target_profile_status := 'active';
    review_action := 'coach_certification.rejected';
    review_title := '지도자 인증 신청을 보완해 주세요';
    review_body := normalized_reason;
  end if;

  update public.coach_profiles
  set
    status = target_coach_status,
    reviewed_by = acting_admin.id,
    reviewed_at = review_time,
    rejection_reason = case when checked_decision = 'reject' then normalized_reason else null end
  where coach_profiles.id = selected_coach.id;

  update public.profiles
  set status = target_profile_status
  where profiles.id = selected_profile.id;

  if checked_decision = 'approve' then
    update public.coach_certificates
    set verified_at = coalesce(verified_at, review_time), rejected_reason = null
    where coach_certificates.coach_profile_id = selected_coach.id;
  end if;

  insert into public.audit_logs (
    actor_id,
    action,
    target_type,
    target_id,
    before_data,
    after_data
  ) values (
    acting_admin.id,
    review_action,
    'coach_profile',
    selected_coach.id,
    jsonb_build_object(
      'coachStatus', selected_coach.status,
      'profileStatus', selected_profile.status
    ),
    jsonb_build_object(
      'coachStatus', target_coach_status,
      'profileStatus', target_profile_status,
      'submittedAt', selected_coach.submitted_at
    )
  );

  insert into public.notifications (user_id, type, title, body, data)
  values (
    selected_profile.id,
    'coach_certification.reviewed',
    review_title,
    review_body,
    jsonb_build_object(
      'coachProfileId', selected_coach.id,
      'decision', checked_decision,
      'submittedAt', selected_coach.submitted_at
    )
  );

  return query select
    selected_coach.id,
    target_coach_status,
    target_profile_status,
    review_time,
    false;
end;
$$;

revoke all on function public.review_coach_application(uuid, text, text) from public, anon;
grant execute on function public.review_coach_application(uuid, text, text) to authenticated;
