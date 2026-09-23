-- =============================================================================
-- 0022 — ADMIN vê o profile de qualquer membro do próprio espaço, mesmo com
-- status 'disabled'/'invited'. `profiles_select_space_peers` (0005) usa
-- `app.shares_space_with`, que exige status='active' dos DOIS lados — isso
-- faz nome/e-mail de um membro desativado desaparecerem justo na tela onde o
-- ADMIN precisa gerenciá-lo (Equipe). Política adicional, aditiva (RLS faz OR
-- entre políticas do mesmo comando) — não remove nenhuma restrição existente.
-- =============================================================================

create policy profiles_select_space_admin_managed
  on public.profiles for select
  to authenticated
  using (
    exists (
      select 1 from public.space_members sm
      where sm.profile_id = profiles.id
        and app.is_space_admin(sm.space_id)
    )
  );
