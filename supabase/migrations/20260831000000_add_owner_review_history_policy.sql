create policy "reviews_owner_visible_hidden_select" on public.reviews
  as permissive
  for select
  to authenticated
  using (
    reviewer_id = (select auth.uid())
    and status in ('visible', 'hidden')
  );
