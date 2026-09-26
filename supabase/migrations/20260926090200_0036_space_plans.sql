-- =============================================================================
-- 0036 — Plano do espaço: limite de processos e de processos com
-- sincronização automática (ex.: Free = 10 processos, 3 sincronizados).
--
-- - Só a administração da plataforma define os limites (gatilho da 0035).
-- - "Processos" conta tudo que não foi excluído (ativos, arquivados, encerrados).
-- - "Sincronizados" conta os ativos com CNJ, `tracking_enabled` e tribunal com
--   coleta automática — exatamente os que a rotina diária coleta.
-- - Reduzir um limite abaixo do uso atual NÃO mexe no que já existe: só
--   bloqueia novos cadastros/ativações. A mitigação (escolher o que sai da
--   sincronização etc.) está em docs/PLANOS.md como trabalho futuro.
-- =============================================================================

alter table public.spaces
  add column max_processes integer not null default 10,
  add column max_tracked_processes integer not null default 3,
  add constraint spaces_max_processes_chk check (max_processes >= 0),
  add constraint spaces_max_tracked_processes_chk check (max_tracked_processes >= 0);

comment on column public.spaces.max_processes is
  'Plano: máximo de processos não excluídos no espaço.';
comment on column public.spaces.max_tracked_processes is
  'Plano: máximo de processos ativos com sincronização automática (coleta diária).';

create or replace function app.space_process_count(p_space uuid, p_exclude uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.processes
  where space_id = p_space and deleted_at is null and id is distinct from p_exclude;
$$;

create or replace function app.court_is_tracked(p_court uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.courts where id = p_court and tracking_source_kind is not null);
$$;

create or replace function app.space_tracked_count(p_space uuid, p_exclude uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.processes p
  join public.courts c on c.id = p.court_id and c.tracking_source_kind is not null
  where p.space_id = p_space
    and p.deleted_at is null
    and p.status = 'active'
    and p.tracking_enabled
    and p.cnj_number is not null
    and p.id is distinct from p_exclude;
$$;

-- ---------------------------------------------------------------------------
-- Aplicação do plano em processes (insert, restauração, ativação, sync).
-- ---------------------------------------------------------------------------
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
  select max_processes, max_tracked_processes
    into v_max, v_max_tracked
    from public.spaces where id = new.space_id
    for update;

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

create trigger processes_enforce_plan
  before insert or update on public.processes
  for each row execute function app.processes_enforce_plan();

-- Uso do plano, para o ADMIN/colaborador saberem por que um cadastro foi
-- recusado. O SUPER_ADMIN não chama: só conhece os limites, não o uso.
create or replace function public.space_plan_usage(p_space_id uuid)
returns table (
  max_processes         integer,
  used_processes        integer,
  max_tracked_processes integer,
  used_tracked          integer
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
    select s.max_processes, app.space_process_count(s.id),
           s.max_tracked_processes, app.space_tracked_count(s.id)
    from public.spaces s where s.id = p_space_id;
end;
$$;

revoke execute on function public.space_plan_usage(uuid) from public;
grant execute on function public.space_plan_usage(uuid) to authenticated;

-- Mudança de plano também é ação de plataforma auditada.
create or replace function app.audit_spaces_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.max_processes, new.max_tracked_processes)
       is distinct from (old.max_processes, old.max_tracked_processes) then
    perform app.write_audit_log(
      'space.plan.update', null, 'space', new.id::text, 'success', app._audit_actor(),
      jsonb_build_object('max_processes', old.max_processes, 'max_tracked_processes', old.max_tracked_processes),
      jsonb_build_object('max_processes', new.max_processes, 'max_tracked_processes', new.max_tracked_processes),
      null
    );
  end if;
  return null;
end;
$$;

create trigger zz_audit_spaces_plan
  after update on public.spaces
  for each row execute function app.audit_spaces_plan();
