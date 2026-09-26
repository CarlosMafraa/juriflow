-- =============================================================================
-- 0035 — Suspensão de espaço de verdade + SUPER_ADMIN fora do conteúdo dos espaços.
--
-- 1. Suspensão: antes, `spaces.status = 'suspended'` não era lido por nenhuma
--    regra — membros continuavam acessando tudo. Agora os helpers de papel
--    (base de TODA a RLS e das RPCs) só reconhecem vínculos em espaço ativo.
--    O membro ainda enxerga a linha do próprio espaço e do próprio vínculo,
--    para o app mostrar "espaço suspenso" em vez de "sem espaço".
--
-- 2. SUPER_ADMIN (regra do produto): sabe que o espaço existe (nome, status,
--    plano), mas não vê nada de dentro dele nem consegue entrar nele. Saem as
--    exceções `is_super_admin()` de membros, auditoria do espaço, convites,
--    templates, regras e WhatsApp. Criar espaço passa a ser só pela RPC
--    `create_space_with_admin`, que proíbe o SUPER_ADMIN de se nomear ADMIN.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. CORREÇÃO DE SEGURANÇA: is_space_admin devolvia NULL (e não false) para
--    quem não é membro — `role_in_space` sem linha = NULL, e NULL = 'ADMIN' é
--    NULL. Na RLS NULL nega, mas em PL/pgSQL `if not app.is_space_admin(x)
--    then raise` com NULL NÃO levanta: qualquer usuário de outro escritório
--    passava pelas RPCs. Ex. comprovado: create_space_invite(espaço alheio,
--    próprio e-mail, 'ADMIN') + accept_space_invite = virar ADMIN de qualquer
--    espaço. Corrigido na raiz: o helper sempre devolve true/false.
-- ---------------------------------------------------------------------------
create or replace function app.is_space_admin(target_space uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.role_in_space(target_space) = 'ADMIN', false);
$$;

-- ---------------------------------------------------------------------------
-- 1. Helpers de papel só valem em espaço ATIVO
-- ---------------------------------------------------------------------------
create or replace function app.role_in_space(target_space uuid)
returns public.space_role
language sql
stable
security definer
set search_path = ''
as $$
  select sm.role
  from public.space_members sm
  join public.spaces s on s.id = sm.space_id
  where sm.space_id = target_space
    and sm.profile_id = (select auth.uid())
    and sm.status = 'active'
    and s.status = 'active'
  limit 1;
$$;

create or replace function app.is_active_member(target_space uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.space_members sm
    join public.spaces s on s.id = sm.space_id
    where sm.space_id = target_space
      and sm.profile_id = (select auth.uid())
      and sm.status = 'active'
      and s.status = 'active'
  );
$$;

create or replace function app.is_active_member_of(p_space uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.space_members sm
    join public.spaces s on s.id = sm.space_id
    where sm.space_id = p_space
      and sm.profile_id = p_profile
      and sm.status = 'active'
      and s.status = 'active'
  );
$$;

-- Vínculo ativo, com o espaço suspenso ou não — só para o membro ler o nome e o
-- status do próprio espaço (tela "espaço suspenso").
create or replace function app.is_member_ignoring_suspension(target_space uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.space_members sm
    where sm.space_id = target_space
      and sm.profile_id = (select auth.uid())
      and sm.status = 'active'
  );
$$;

drop policy spaces_select on public.spaces;
create policy spaces_select
  on public.spaces for select
  to authenticated
  using (app.is_super_admin() or app.is_member_ignoring_suspension(id));

-- ---------------------------------------------------------------------------
-- 2. space_members: só membros do espaço (e o próprio vínculo). Sem SUPER_ADMIN.
-- ---------------------------------------------------------------------------
drop policy space_members_select on public.space_members;
drop policy space_members_insert on public.space_members;
drop policy space_members_update on public.space_members;
drop policy space_members_delete on public.space_members;

create policy space_members_select
  on public.space_members for select
  to authenticated
  using (profile_id = (select auth.uid()) or app.is_active_member(space_id));

create policy space_members_insert
  on public.space_members for insert
  to authenticated
  with check (app.is_space_admin(space_id));

create policy space_members_update
  on public.space_members for update
  to authenticated
  using (app.is_space_admin(space_id))
  with check (app.is_space_admin(space_id));

create policy space_members_delete
  on public.space_members for delete
  to authenticated
  using (app.is_space_admin(space_id));

-- ---------------------------------------------------------------------------
-- 3. Conteúdo do espaço sem exceção para SUPER_ADMIN
-- ---------------------------------------------------------------------------
drop policy audit_logs_select on public.audit_logs;
create policy audit_logs_select
  on public.audit_logs for select
  to authenticated
  using (
    -- Ações de plataforma (sem espaço): criar/suspender espaço, tribunais...
    (space_id is null and app.is_super_admin())
    -- Trilha do espaço: só o ADMIN dele.
    or (space_id is not null and app.is_space_admin(space_id))
  );

drop policy space_invites_select on public.space_invites;
create policy space_invites_select
  on public.space_invites for select
  to authenticated
  using (app.is_space_admin(space_id));

drop policy message_templates_select on public.message_templates;
create policy message_templates_select
  on public.message_templates for select
  to authenticated
  using (app.is_active_member(space_id));

drop policy space_notification_configs_select on public.space_notification_configs;
create policy space_notification_configs_select
  on public.space_notification_configs for select
  to authenticated
  using (app.is_active_member(space_id));

drop policy whatsapp_sessions_select on public.whatsapp_sessions;
create policy whatsapp_sessions_select
  on public.whatsapp_sessions for select
  to authenticated
  using (app.is_space_admin(space_id));

-- ---------------------------------------------------------------------------
-- 4. Criação de espaço só por RPC (espaço + 1º ADMIN, atômico)
-- ---------------------------------------------------------------------------
drop policy spaces_insert on public.spaces;
revoke insert on public.spaces from authenticated;

create or replace function public.create_space_with_admin(
  p_name             text,
  p_slug             text,
  p_admin_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.is_super_admin() then
    raise exception 'Somente a administração da plataforma cria espaços.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_admin_profile_id = (select auth.uid()) then
    raise exception 'A administração da plataforma não pode ser ADMIN de um espaço que cria.'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.profiles where id = p_admin_profile_id) then
    raise exception 'Usuário escolhido como ADMIN não existe.' using errcode = 'no_data_found';
  end if;

  insert into public.spaces (name, slug, created_by)
  values (btrim(p_name), p_slug, (select auth.uid()))
  returning id into v_id;

  insert into public.space_members (space_id, profile_id, role, status, invited_by, invited_at, accepted_at)
  values (v_id, p_admin_profile_id, 'ADMIN', 'active', (select auth.uid()), now(), now());

  -- Ação de plataforma: space_id nulo, o espaço vai em entity_id.
  perform app.write_audit_log(
    'space.create', null, 'space', v_id::text, 'success', 'user',
    null, jsonb_build_object('name', btrim(p_name)), null
  );
  return v_id;
end;
$$;

revoke execute on function public.create_space_with_admin(text, text, uuid) from public;
grant execute on function public.create_space_with_admin(text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Quem altera o quê em spaces
--    status (e, na 0036, o plano) -> só SUPER_ADMIN
--    demais dados (nome, cores)   -> só o ADMIN do espaço
-- ---------------------------------------------------------------------------
create or replace function app.spaces_guard_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_platform_cols constant text[] := array['status', 'max_processes', 'max_tracked_processes'];
  v_ignored_cols  constant text[] := array['updated_at'];
begin
  -- Contextos de sistema (service_role, migrations) passam.
  if (select auth.uid()) is null then
    return new;
  end if;

  if (to_jsonb(new) - (v_ignored_cols)) is not distinct from (to_jsonb(old) - (v_ignored_cols)) then
    return new;
  end if;

  if exists (
    select 1 from unnest(v_platform_cols) c
    where (to_jsonb(new) -> c) is distinct from (to_jsonb(old) -> c)
  ) and not app.is_super_admin() then
    raise exception 'Status e plano do espaço são definidos pela administração da plataforma.'
      using errcode = 'insufficient_privilege';
  end if;

  if (to_jsonb(new) - (v_platform_cols || v_ignored_cols))
       is distinct from (to_jsonb(old) - (v_platform_cols || v_ignored_cols))
     and not app.is_space_admin(old.id) then
    raise exception 'Somente o ADMIN do espaço altera os dados do espaço.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger spaces_guard_update
  before update on public.spaces
  for each row execute function app.spaces_guard_update();

-- Suspender/reativar é ação de plataforma: auditada sem space_id (o ADMIN do
-- espaço não a vê; o SUPER_ADMIN vê só o que é de plataforma).
create or replace function app.audit_spaces_platform()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    perform app.write_audit_log(
      case when new.status = 'suspended' then 'space.suspend' else 'space.reactivate' end,
      null, 'space', new.id::text, 'success', app._audit_actor(),
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status), null
    );
  end if;
  return null;
end;
$$;

create trigger zz_audit_spaces_platform
  after update on public.spaces
  for each row execute function app.audit_spaces_platform();
