-- =============================================================================
-- 0040 — SUPER_ADMIN único, criado sem alteração manual no banco, e plataforma
-- sem nenhuma informação de dentro dos escritórios.
--
-- Regras do produto (docs/REGRAS-DE-NEGOCIO.md):
--   - Existe um único SUPER_ADMIN.
--   - Nada é alterado "na mão" no banco de produção — nem para criar o
--     SUPER_ADMIN. O primeiro é criado por comando versionado
--     (scripts/bootstrap-super-admin.mjs) que chama bootstrap_super_admin,
--     só funciona enquanto não existe nenhum e fica na auditoria.
--   - A plataforma sabe que o escritório existe e nada sobre ele: nem
--     contagem de usuários, nem contas novas por mês, nem colunas internas do
--     espaço (cores etc.). Lê e altera escritórios só pelas funções abaixo.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. SUPER_ADMIN único
-- ---------------------------------------------------------------------------
create unique index profiles_single_super_admin
  on public.profiles ((true))
  where is_super_admin;

create or replace function public.bootstrap_super_admin(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if exists (select 1 from public.profiles where is_super_admin) then
    raise exception 'Já existe um SUPER_ADMIN. A plataforma tem um único administrador.'
      using errcode = 'check_violation';
  end if;

  select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_id is null then
    raise exception 'Conta % não encontrada. Convide o e-mail antes de promovê-lo.', p_email
      using errcode = 'no_data_found';
  end if;

  update public.profiles set is_super_admin = true where id = v_id;

  perform app.write_audit_log(
    'platform.super_admin.grant', null, 'profile', v_id::text, 'success', 'system',
    null, jsonb_build_object('email', lower(btrim(p_email))), jsonb_build_object('via', 'bootstrap')
  );
  return v_id;
end;
$$;

-- Só o service_role (o comando de bootstrap) — nunca um usuário logado.
revoke all on function public.bootstrap_super_admin(text) from public, anon, authenticated;
grant execute on function public.bootstrap_super_admin(text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Plataforma lê e altera escritórios só por funções próprias
-- ---------------------------------------------------------------------------
drop policy spaces_select on public.spaces;
create policy spaces_select
  on public.spaces for select
  to authenticated
  using (app.is_member_ignoring_suspension(id));

drop policy spaces_update on public.spaces;
create policy spaces_update
  on public.spaces for update
  to authenticated
  using (app.is_space_admin(id))
  with check (
    app.is_space_admin(id)
    and status is not distinct from (select s.status from public.spaces s where s.id = spaces.id)
  );

create or replace function public.platform_set_space_status(p_space_id uuid, p_status public.space_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_super_admin() then
    raise exception 'Somente a administração da plataforma.' using errcode = 'insufficient_privilege';
  end if;
  update public.spaces set status = p_status where id = p_space_id;
  if not found then
    raise exception 'Escritório não encontrado.' using errcode = 'no_data_found';
  end if;
end;
$$;

create or replace function public.platform_set_space_plan(
  p_space_id uuid,
  p_max_processes integer,
  p_max_tracked_processes integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_super_admin() then
    raise exception 'Somente a administração da plataforma.' using errcode = 'insufficient_privilege';
  end if;
  update public.spaces
     set max_processes = p_max_processes, max_tracked_processes = p_max_tracked_processes
   where id = p_space_id;
  if not found then
    raise exception 'Escritório não encontrado.' using errcode = 'no_data_found';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Sem contagem de usuários
-- ---------------------------------------------------------------------------
drop function public.platform_overview();
create function public.platform_overview()
returns table (active_spaces integer, pending_setup integer, suspended_spaces integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_super_admin() then
    raise exception 'Somente a administração da plataforma.' using errcode = 'insufficient_privilege';
  end if;
  -- Situação exclusiva: suspenso > aguardando configuração > ativo.
  return query
    select count(*) filter (where status = 'active' and setup_completed_at is not null)::int,
           count(*) filter (where status = 'active' and setup_completed_at is null)::int,
           count(*) filter (where status = 'suspended')::int
    from public.spaces;
end;
$$;

drop function public.platform_growth(integer);
create function public.platform_growth(p_months integer default 6)
returns table (month date, new_spaces integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n integer := least(greatest(coalesce(p_months, 6), 1), 24);
begin
  if not app.is_super_admin() then
    raise exception 'Somente a administração da plataforma.' using errcode = 'insufficient_privilege';
  end if;
  return query
    with months as (
      select (date_trunc('month', now() at time zone 'America/Manaus')
              - make_interval(months => g))::date as month
      from generate_series(0, v_n - 1) g
    )
    select m.month,
           (select count(*)::int from public.spaces s
             where date_trunc('month', s.created_at at time zone 'America/Manaus')::date = m.month)
    from months m
    order by m.month;
end;
$$;

revoke execute on function public.platform_set_space_status(uuid, public.space_status) from public;
revoke execute on function public.platform_set_space_plan(uuid, integer, integer) from public;
revoke execute on function public.platform_overview() from public;
revoke execute on function public.platform_growth(integer) from public;
grant execute on function public.platform_set_space_status(uuid, public.space_status) to authenticated;
grant execute on function public.platform_set_space_plan(uuid, integer, integer) to authenticated;
grant execute on function public.platform_overview() to authenticated;
grant execute on function public.platform_growth(integer) to authenticated;
