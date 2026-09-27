-- =============================================================================
-- 0031 — Endurece o bucket `avatars` (0028).
--
-- Antes: sem limite de tamanho nem de tipo (dava para subir HTML/SVG num
-- bucket público, servido do domínio do Supabase) e a policy de SELECT para
-- `public` permitia LISTAR o bucket inteiro — enumerando o id de todos os
-- usuários da plataforma.
--
-- Bucket público não precisa de policy de SELECT para servir o arquivo pela
-- URL pública; a policy só é necessária para o próprio dono (o upload com
-- `upsert: true` lê o objeto antes de sobrescrever).
-- =============================================================================

update storage.buckets
   set file_size_limit = 2 * 1024 * 1024,
       allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
 where id = 'avatars';

drop policy if exists avatars_public_read on storage.objects;

create policy avatars_own_folder_select
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
