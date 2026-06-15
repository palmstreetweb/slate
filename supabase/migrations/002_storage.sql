-- Storage policies for form-uploads bucket (ADR-028)

insert into storage.buckets (id, name, public)
values ('form-uploads', 'form-uploads', false)
on conflict (id) do nothing;

-- PSW team can read/write all objects in form-uploads
create policy form_uploads_psw_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'form-uploads'
    and public.is_psw_team()
  );

create policy form_uploads_psw_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'form-uploads'
    and public.is_psw_team()
  );

create policy form_uploads_psw_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'form-uploads'
    and public.is_psw_team()
  );

create policy form_uploads_psw_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'form-uploads'
    and public.is_psw_team()
  );

-- Anonymous uploads during public fill (path must start with public/)
create policy form_uploads_anon_insert on storage.objects
  for insert to anon
  with check (
    bucket_id = 'form-uploads'
    and (storage.foldername(name))[1] = 'public'
  );

-- Signed URLs for public reads handled via service role in edge function;
-- team reads via authenticated policy above.
