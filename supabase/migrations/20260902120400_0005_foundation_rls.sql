-- =============================================================================
-- 0005 — Políticas RLS entre tabelas (spaces, profiles) + grants
-- =============================================================================

-- ---------------------------------------------------------------------------
-- spaces
-- ---------------------------------------------------------------------------
-- SELECT: membro ativo do espaço, ou SUPER_ADMIN (metadados do tenant).
create policy spaces_select
  on public.spaces for select
  to authenticated
  using (app.is_super_admin() or app.is_active_member(id));

-- INSERT: somente SUPER_ADMIN provisiona espaços (F17). Self-signup de espaço = DP-36.
create policy spaces_insert
  on public.spaces for insert
  to authenticated
  with check (app.is_super_admin());

-- UPDATE: SUPER_ADMIN (qualquer campo) ou ADMIN do espaço (sem mexer em status).
create policy spaces_update
  on public.spaces for update
  to authenticated
  using (app.is_super_admin() or app.is_space_admin(id))
  with check (
    app.is_super_admin()
    or (
      app.is_space_admin(id)
      and status is not distinct from (
        select s.status from public.spaces s where s.id = spaces.id
      )
    )
  );

-- Sem DELETE: espaços são suspensos, não apagados.

-- ---------------------------------------------------------------------------
-- profiles — políticas adicionais
-- ---------------------------------------------------------------------------
-- SELECT: colegas de espaço (necessário p/ atribuir responsável, listar membros).
create policy profiles_select_space_peers
  on public.profiles for select
  to authenticated
  using (app.shares_space_with(id));

-- SELECT: SUPER_ADMIN vê todos os perfis (escolher quem vira ADMIN — DP-35).
create policy profiles_select_super_admin
  on public.profiles for select
  to authenticated
  using (app.is_super_admin());

-- UPDATE: SUPER_ADMIN pode alterar qualquer perfil (inclusive conceder/revogar
-- is_super_admin). Auditado na camada de aplicação (fase futura).
create policy profiles_update_super_admin
  on public.profiles for update
  to authenticated
  using (app.is_super_admin())
  with check (app.is_super_admin());

-- Somente SUPER_ADMIN pode alterar a flag `is_super_admin` (RT-02). Gatilho em
-- vez de subconsulta na policy, para não recorrer a `profiles` dentro da RLS.
create or replace function app.protect_super_admin_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Bloqueia apenas usuários autenticados (superfície da API). Contextos de
  -- confiança sem JWT (service_role, migrations, scripts admin) passam.
  if new.is_super_admin is distinct from old.is_super_admin
     and (select auth.uid()) is not null
     and not app.is_super_admin() then
    raise exception 'Somente SUPER_ADMIN pode alterar is_super_admin.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_super_admin
  before update on public.profiles
  for each row execute function app.protect_super_admin_flag();

-- ---------------------------------------------------------------------------
-- Grants de tabela (RLS ainda decide linha a linha; sem grant, nem RLS salva).
-- ---------------------------------------------------------------------------
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.spaces to authenticated;
grant select, insert, update, delete on public.space_members to authenticated;
