-- =============================================================================
-- 0017 — Acompanhamento-A: process_tracking_configs + process_tracking_state
-- =============================================================================

-- ---------------------------------------------------------------------------
-- compute_next_run_at — próxima execução (com jitter para não concentrar carga)
-- ---------------------------------------------------------------------------
create or replace function app.compute_next_run_at(
  p_frequency  interval,
  p_schedule_time time,
  p_timezone   text
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_jitter interval := (random() * interval '15 minutes');
  v_local_date date;
  v_candidate timestamptz;
begin
  if p_frequency = interval '1 day' then
    v_local_date := (now() at time zone p_timezone)::date;
    v_candidate := ((v_local_date + p_schedule_time) at time zone p_timezone);
    if v_candidate <= now() then
      v_candidate := (((v_local_date + 1) + p_schedule_time) at time zone p_timezone);
    end if;
    return v_candidate + v_jitter;
  end if;
  return now() + p_frequency + v_jitter;
end;
$$;

-- ---------------------------------------------------------------------------
-- process_tracking_configs — "acompanhe este processo nesta fonte"
-- ---------------------------------------------------------------------------
create table public.process_tracking_configs (
  id                   uuid primary key default gen_random_uuid(),
  space_id             uuid not null references public.spaces (id) on delete cascade,
  process_id           uuid not null references public.processes (id) on delete cascade,
  source_kind          public.source_kind not null,
  court_strategy_id    uuid references public.court_tracking_strategies (id) on delete set null,
  enabled              boolean not null default true,
  frequency            interval not null default interval '1 day',
  schedule_time        time not null default time '08:00',
  timezone             text not null default 'America/Manaus',
  next_run_at          timestamptz,
  last_run_at          timestamptz,
  last_run_status      public.collection_run_status,
  consecutive_failures int not null default 0,
  paused_at            timestamptz,
  pause_reason         text,
  source_params        jsonb not null default '{}'::jsonb,
  credentials_ref      text,
  created_by           uuid not null references public.profiles (id) on delete restrict,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz,
  constraint ptc_process_source_uniq unique (process_id, source_kind),
  constraint ptc_frequency_positive_chk check (frequency >= interval '1 hour')
);

comment on table public.process_tracking_configs is
  'Uma linha por (processo, fonte). Fonte derivada de court_tracking_strategies; ADMIN só habilita/desabilita.';

create index ptc_due_idx
  on public.process_tracking_configs (enabled, next_run_at) where enabled and paused_at is null;
create index ptc_process_idx on public.process_tracking_configs (process_id);
create index ptc_space_idx on public.process_tracking_configs (space_id);

-- --- triggers ---
create or replace function app.ptc_set_space()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select space_id into new.space_id from public.processes where id = new.process_id;
  if new.space_id is null then
    raise exception 'Processo % inexistente.', new.process_id using errcode = 'foreign_key_violation';
  end if;
  if new.next_run_at is null then
    new.next_run_at := app.compute_next_run_at(new.frequency, new.schedule_time, new.timezone);
  end if;
  return new;
end;
$$;
create trigger ptc_set_space
  before insert on public.process_tracking_configs
  for each row execute function app.ptc_set_space();

create or replace function app.ptc_resolve_strategy()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_court uuid;
  v_strategy uuid;
begin
  select court_id into v_court from public.processes where id = new.process_id;
  select id into v_strategy
    from public.court_tracking_strategies
    where court_id = v_court and source_kind = new.source_kind and enabled;
  if v_strategy is null then
    raise exception 'Fonte "%" não é uma estratégia de acompanhamento habilitada para o tribunal do processo.',
      new.source_kind using errcode = 'check_violation';
  end if;
  new.court_strategy_id := v_strategy;
  return new;
end;
$$;
create trigger ptc_resolve_strategy
  before insert or update of source_kind on public.process_tracking_configs
  for each row execute function app.ptc_resolve_strategy();

create or replace function app.ptc_guard_field_updates()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.space_id is distinct from old.space_id
     or new.process_id is distinct from old.process_id
     or new.created_by is distinct from old.created_by then
    raise exception 'process_tracking_configs: space_id/process_id/created_by são imutáveis.'
      using errcode = 'check_violation';
  end if;

  if app.is_space_admin(old.space_id) then
    return new;
  end if;

  -- Não-ADMIN (responsável atual): só pode ligar/desligar.
  if new.source_kind is distinct from old.source_kind
     or new.frequency is distinct from old.frequency
     or new.schedule_time is distinct from old.schedule_time
     or new.timezone is distinct from old.timezone
     or new.source_params is distinct from old.source_params
     or new.credentials_ref is distinct from old.credentials_ref
     or new.court_strategy_id is distinct from old.court_strategy_id
     or new.consecutive_failures is distinct from old.consecutive_failures
     or new.paused_at is distinct from old.paused_at
     or new.pause_reason is distinct from old.pause_reason then
    raise exception 'Somente ADMIN altera fonte, frequência, parâmetros ou credenciais do acompanhamento.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger ptc_guard_field_updates
  before update on public.process_tracking_configs
  for each row execute function app.ptc_guard_field_updates();

create trigger ptc_set_updated_at
  before update on public.process_tracking_configs
  for each row execute function app.set_updated_at();

-- --- RLS ---
alter table public.process_tracking_configs enable row level security;
alter table public.process_tracking_configs force row level security;

create policy ptc_select
  on public.process_tracking_configs for select to authenticated
  using (app.can_read_process(process_id));

create policy ptc_insert
  on public.process_tracking_configs for insert to authenticated
  with check (app.can_read_process(process_id) and created_by = (select auth.uid()));

create policy ptc_update
  on public.process_tracking_configs for update to authenticated
  using (app.can_read_process(process_id))
  with check (app.can_read_process(process_id));

create policy ptc_delete
  on public.process_tracking_configs for delete to authenticated
  using (app.is_space_admin(space_id));

grant select, insert, update, delete on public.process_tracking_configs to authenticated;

-- ---------------------------------------------------------------------------
-- process_tracking_state — estado anterior para o detector (processo × fonte)
-- Escrito apenas pelas RPCs SECURITY DEFINER.
-- ---------------------------------------------------------------------------
create table public.process_tracking_state (
  id                        uuid primary key default gen_random_uuid(),
  space_id                  uuid not null references public.spaces (id) on delete cascade,
  process_id                uuid not null references public.processes (id) on delete cascade,
  source_kind               public.source_kind not null,
  state_hash                text,
  first_sync_done           boolean not null default false,
  last_synced_at            timestamptz,
  last_movement_occurred_at timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz,
  constraint pts_process_source_uniq unique (process_id, source_kind)
);

create or replace function app.pts_set_space()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select space_id into new.space_id from public.processes where id = new.process_id;
  if new.space_id is null then
    raise exception 'Processo % inexistente.', new.process_id using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;
create trigger pts_set_space
  before insert on public.process_tracking_state
  for each row execute function app.pts_set_space();
create trigger pts_set_updated_at
  before update on public.process_tracking_state
  for each row execute function app.set_updated_at();

alter table public.process_tracking_state enable row level security;
alter table public.process_tracking_state force row level security;

create policy pts_select
  on public.process_tracking_state for select to authenticated
  using (app.can_read_process(process_id));

grant select on public.process_tracking_state to authenticated;
revoke insert, update, delete on public.process_tracking_state from authenticated, anon;
