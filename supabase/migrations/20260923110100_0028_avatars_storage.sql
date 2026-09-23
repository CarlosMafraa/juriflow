-- =============================================================================
-- 0028 — bucket de Storage para foto de perfil. Primeiro uso de Storage no
-- projeto: bucket público (a foto em si não é dado sensível), caminho sempre
-- `{profile_id}/...` — cada usuário só escreve/apaga dentro da própria pasta.
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy avatars_public_read
  on storage.objects for select
  to public
  using (bucket_id = 'avatars');

create policy avatars_own_folder_insert
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy avatars_own_folder_update
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy avatars_own_folder_delete
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
