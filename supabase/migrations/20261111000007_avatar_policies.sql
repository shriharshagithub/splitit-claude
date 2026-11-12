-- Profile photo uploads failed: the app uploaded with upsert, and Storage requires a SELECT policy
-- for upsert. Let users read and remove objects in their own avatar folder.
create policy "read own avatar" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "delete own avatar" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
