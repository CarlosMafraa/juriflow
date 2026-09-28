-- =============================================================================
-- 0049 — Catálogo de planos (P8/P11).
--
-- Antes, cada espaço guardava os próprios limites. Agora o SUPER_ADMIN mantém
-- uma lista de planos (limite de processos, de processos sincronizados e a
-- carência anti-rodízio em dias) e atrela cada espaço a um plano. O espaço
-- ainda pode ter EXCEÇÃO: max_processes / max_tracked_processes /
-- tracking_hold_days no espaço, quando preenchidos, valem no lugar do plano.
-- Todos os espaços começam no plano "Free" (o padrão).
-- =============================================================================

create table public.plans (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  max_processes         integer not null,
  max_tracked_processes integer not null,
  tracking_hold_days    integer not null,
  is_default            boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz,
  constraint plans_name_not_blank_chk check (length(btrim(name)) > 0),
  constraint plans_max_processes_chk check (max_processes >= 0),
  constraint plans_max_tracked_processes_chk check (max_tracked_processes >= 0),
  constraint plans_tracking_hold_days_chk check (tracking_hold_days between 0 and 365)
);

comment on table public.plans is
  'Planos da plataforma. O espaço segue o plano, salvo exceção gravada no próprio espaço.';
comment on column public.plans.tracking_hold_days is
  'Anti-rodízio: dias que a vaga de sincronização fica presa depois de desligar/arquivar.';

create unique index plans_name_uniq on public.plans (lower(btrim(name)));
create unique index plans_single_default_uniq on public.plans (is_default) where is_default;

create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function app.set_updated_at();

alter table public.plans enable row level security;
alter table public.plans force row level security;

-- Só a plataforma lê a tabela; o espaço vê o próprio plano por space_plan_usage.
create policy plans_select
  on public.plans for select
  to authenticated
  using (app.is_super_admin());

grant select on public.plans to authenticated;
revoke insert, update, delete on public.plans from authenticated, anon;
grant select, insert, update, delete on public.plans to service_role;

insert into public.plans (name, max_processes, max_tracked_processes, tracking_hold_days, is_default)
values ('Free', 10, 3, 30, true);

-- ---------------------------------------------------------------------------
-- Espaço → plano; os números do espaço viram exceção (null = segue o plano)
-- ---------------------------------------------------------------------------
alter table public.spaces add column plan_id uuid references public.plans (id) on delete restrict;
update public.spaces set plan_id = (select id from public.plans where is_default);
alter table public.spaces alter column plan_id set not null;

alter table public.spaces
  alter column max_processes drop not null,
  alter column max_processes drop default,
  alter column max_tracked_processes drop not null,
  alter column max_tracked_processes drop default,
  add column tracking_hold_days integer,
  add constraint spaces_tracking_hold_days_chk
    check (tracking_hold_days is null or tracking_hold_days between 0 and 365);

-- Quem já estava com os números do Free passa a simplesmente seguir o plano.
update public.spaces set max_processes = null where max_processes = 10;
update public.spaces set max_tracked_processes = null where max_tracked_processes = 3;

comment on column public.spaces.max_processes is
  'Exceção ao plano (null = vale o plano). Só a plataforma altera.';
comment on column public.spaces.max_tracked_processes is
  'Exceção ao plano (null = vale o plano). Só a plataforma altera.';
comment on column public.spaces.tracking_hold_days is
  'Exceção ao plano (null = vale o plano). Só a plataforma altera.';

-- Espaço novo entra no plano padrão.
create or replace function app.spaces_default_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.plan_id is null then
    select id into new.plan_id from public.plans where is_default;
  end if;
  return new;
end;
$$;

create trigger spaces_default_plan
  before insert on public.spaces
  for each row execute function app.spaces_default_plan();

/** Limites valendo para o espaço: a exceção do espaço, senão o plano. */
create or replace function app.space_limits(p_space uuid)
returns table (max_processes integer, max_tracked_processes integer, tracking_hold_days integer)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(s.max_processes, p.max_processes),
         coalesce(s.max_tracked_processes, p.max_tracked_processes),
         coalesce(s.tracking_hold_days, p.tracking_hold_days)
    from public.spaces s
    join public.plans p on p.id = s.plan_id
   where s.id = p_space;
$$;

create or replace function app.space_tracked_count(p_space uuid, p_exclude uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.processes p
   where p.space_id = p_space
     and p.id is distinct from p_exclude
     and (
       app.process_counts_as_tracked(p)
       or p.tracking_released_at > now() - make_interval(
            days => (select l.tracking_hold_days from app.space_limits(p_space) l))
     );
$$;

create or replace function app.processes_enforce_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enters_count   boolean;
  v_enters_tracked boolean;
  v_max            integer;
  v_max_tracked    integer;
begin
  v_enters_count := new.deleted_at is null
    and (tg_op = 'INSERT' or old.deleted_at is not null);

  v_enters_tracked := new.deleted_at is null and new.status = 'active'
    and new.tracking_enabled and new.cnj_number is not null
    and (
      tg_op = 'INSERT'
      or not (old.deleted_at is null and old.status = 'active'
              and old.tracking_enabled and old.cnj_number is not null
              and app.court_is_tracked(old.court_id))
    )
    and app.court_is_tracked(new.court_id);

  if not (v_enters_count or v_enters_tracked) then
    return new;
  end if;

  -- Trava a linha do espaço: dois cadastros simultâneos não furam o limite.
  perform 1 from public.spaces where id = new.space_id for update;
  select l.max_processes, l.max_tracked_processes
    into v_max, v_max_tracked
    from app.space_limits(new.space_id) l;

  if v_enters_count and app.space_process_count(new.space_id, new.id) >= v_max then
    raise exception 'Limite do plano atingido: este espaço permite até % processos.', v_max
      using errcode = 'check_violation';
  end if;

  if v_enters_tracked and app.space_tracked_count(new.space_id, new.id) >= v_max_tracked then
    if tg_op = 'UPDATE' and not old.tracking_enabled and new.tracking_enabled then
      -- Pedido explícito de ligar a sincronização: recusa com o motivo.
      raise exception 'Limite de sincronização automática do plano atingido (% processos).', v_max_tracked
        using errcode = 'check_violation';
    end if;
    -- Cadastro, reativação ou CNJ informado: o processo entra sem sincronização.
    new.tracking_enabled := false;
  end if;

  return new;
end;
$$;

-- Uso do plano, visto pelo próprio espaço (agora com o nome do plano e a carência).
drop function public.space_plan_usage(uuid);
create function public.space_plan_usage(p_space_id uuid)
returns table (
  plan_name             text,
  max_processes         integer,
  used_processes        integer,
  max_tracked_processes integer,
  used_tracked          integer,
  tracking_hold_days    integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_active_member(p_space_id) then
    raise exception 'Sem acesso a este espaço.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select p.name, l.max_processes, app.space_process_count(s.id),
           l.max_tracked_processes, app.space_tracked_count(s.id), l.tracking_hold_days
      from public.spaces s
      join public.plans p on p.id = s.plan_id
      cross join app.space_limits(s.id) l
     where s.id = p_space_id;
end;
$$;

revoke execute on function public.space_plan_usage(uuid) from public;
grant execute on function public.space_plan_usage(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Plataforma: guarda, auditoria e funções
-- ---------------------------------------------------------------------------
create or replace function app.spaces_guard_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_platform_cols constant text[] := array[
    'status', 'plan_id', 'max_processes', 'max_tracked_processes', 'tracking_hold_days', 'admin_email'
  ];
  v_ignored_cols  constant text[] := array['updated_at'];
begin
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

create or replace function app.audit_spaces_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.plan_id, new.max_processes, new.max_tracked_processes, new.tracking_hold_days)
       is distinct from (old.plan_id, old.max_processes, old.max_tracked_processes, old.tracking_hold_days) then
    perform app.write_audit_log(
      'space.plan.update', null, 'space', new.id::text, 'success', app._audit_actor(),
      jsonb_build_object('plan_id', old.plan_id, 'max_processes', old.max_processes,
        'max_tracked_processes', old.max_tracked_processes, 'tracking_hold_days', old.tracking_hold_days),
      jsonb_build_object('plan_id', new.plan_id, 'max_processes', new.max_processes,
        'max_tracked_processes', new.max_tracked_processes, 'tracking_hold_days', new.tracking_hold_days),
      null
    );
  end if;
  return null;
end;
$$;

create or replace function app.require_super_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_super_admin() then
    raise exception 'Somente a administração da plataforma.' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

create or replace function public.platform_plans()
returns table (
  id                    uuid,
  name                  text,
  max_processes         integer,
  max_tracked_processes integer,
  tracking_hold_days    integer,
  is_default            boolean,
  spaces_count          integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_super_admin();
  return query
    select p.id, p.name, p.max_processes, p.max_tracked_processes, p.tracking_hold_days,
           p.is_default, (select count(*)::int from public.spaces s where s.plan_id = p.id)
      from public.plans p
     order by p.is_default desc, lower(p.name);
end;
$$;

/** Cria (p_plan_id null) ou altera um plano. Vale na hora para os espaços dele. */
create or replace function public.platform_save_plan(
  p_plan_id               uuid,
  p_name                  text,
  p_max_processes         integer,
  p_max_tracked_processes integer,
  p_tracking_hold_days    integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id     uuid;
  v_before jsonb;
begin
  perform app.require_super_admin();
  if p_plan_id is null then
    insert into public.plans (name, max_processes, max_tracked_processes, tracking_hold_days)
    values (btrim(p_name), p_max_processes, p_max_tracked_processes, p_tracking_hold_days)
    returning id into v_id;
  else
    select to_jsonb(p) into v_before from public.plans p where p.id = p_plan_id;
    update public.plans
       set name = btrim(p_name), max_processes = p_max_processes,
           max_tracked_processes = p_max_tracked_processes,
           tracking_hold_days = p_tracking_hold_days
     where id = p_plan_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Plano não encontrado.' using errcode = 'no_data_found';
    end if;
  end if;

  perform app.write_audit_log(
    case when p_plan_id is null then 'platform.plan.create' else 'platform.plan.update' end,
    null, 'plan', v_id::text, 'success', 'user', v_before,
    (select to_jsonb(p) from public.plans p where p.id = v_id), null
  );
  return v_id;
end;
$$;

create or replace function public.platform_delete_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.plans;
begin
  perform app.require_super_admin();
  select * into v_plan from public.plans where id = p_plan_id;
  if v_plan.id is null then
    raise exception 'Plano não encontrado.' using errcode = 'no_data_found';
  end if;
  if v_plan.is_default then
    raise exception 'O plano padrão não pode ser excluído.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.spaces where plan_id = p_plan_id) then
    raise exception 'Há escritórios neste plano. Mude-os de plano antes de excluir.'
      using errcode = 'check_violation';
  end if;
  delete from public.plans where id = p_plan_id;
  perform app.write_audit_log('platform.plan.delete', null, 'plan', p_plan_id::text, 'success',
    'user', to_jsonb(v_plan), null, null);
end;
$$;

-- Plano do escritório + exceções (null = segue o plano).
drop function public.platform_set_space_plan(uuid, integer, integer);
create function public.platform_set_space_plan(
  p_space_id              uuid,
  p_plan_id               uuid,
  p_max_processes         integer default null,
  p_max_tracked_processes integer default null,
  p_tracking_hold_days    integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_super_admin();
  if not exists (select 1 from public.plans where id = p_plan_id) then
    raise exception 'Plano não encontrado.' using errcode = 'no_data_found';
  end if;
  update public.spaces
     set plan_id = p_plan_id,
         max_processes = p_max_processes,
         max_tracked_processes = p_max_tracked_processes,
         tracking_hold_days = p_tracking_hold_days
   where id = p_space_id;
  if not found then
    raise exception 'Escritório não encontrado.' using errcode = 'no_data_found';
  end if;
end;
$$;

-- Lista de escritórios da plataforma, agora com plano, exceções e o que vale.
drop function public.platform_spaces();
create function public.platform_spaces()
returns table (
  id                              uuid,
  name                            text,
  status                          public.space_status,
  plan_id                         uuid,
  plan_name                       text,
  override_max_processes          integer,
  override_max_tracked_processes  integer,
  override_tracking_hold_days     integer,
  max_processes                   integer,
  max_tracked_processes           integer,
  tracking_hold_days              integer,
  created_at                      timestamptz,
  setup_completed_at              timestamptz,
  admin_email                     text,
  invite_id                       uuid,
  invite_state                    text,
  invite_sent_at                  timestamptz,
  invite_expires_at               timestamptz,
  invite_opened_at                timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_super_admin();
  return query
    select s.id, s.name, s.status, s.plan_id, p.name,
           s.max_processes, s.max_tracked_processes, s.tracking_hold_days,
           lim.max_processes, lim.max_tracked_processes, lim.tracking_hold_days,
           s.created_at, s.setup_completed_at, s.admin_email::text,
           (l.inv).id,
           case when (l.inv).id is null then null else app.invite_state(l.inv) end,
           (l.inv).created_at, (l.inv).expires_at, (l.inv).opened_at
    from public.spaces s
    join public.plans p on p.id = s.plan_id
    cross join lateral app.space_limits(s.id) lim
    -- Só o convite mais recente do ADMIN (os anteriores foram substituídos).
    left join lateral (
      select x as inv from public.space_invites x
      where x.space_id = s.id and x.role = 'ADMIN' and x.email = s.admin_email
      order by (x.superseded_at is null) desc, x.created_at desc
      limit 1
    ) l on true
    order by s.created_at desc;
end;
$$;

revoke execute on function public.platform_plans() from public;
revoke execute on function public.platform_save_plan(uuid, text, integer, integer, integer) from public;
revoke execute on function public.platform_delete_plan(uuid) from public;
revoke execute on function public.platform_set_space_plan(uuid, uuid, integer, integer, integer) from public;
revoke execute on function public.platform_spaces() from public;
grant execute on function public.platform_plans() to authenticated;
grant execute on function public.platform_save_plan(uuid, text, integer, integer, integer) to authenticated;
grant execute on function public.platform_delete_plan(uuid) to authenticated;
grant execute on function public.platform_set_space_plan(uuid, uuid, integer, integer, integer) to authenticated;
grant execute on function public.platform_spaces() to authenticated;
