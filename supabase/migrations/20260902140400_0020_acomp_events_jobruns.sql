-- =============================================================================
-- 0020 — Acompanhamento-A: process_change_events (feed p/ Notificações) + job_runs
-- =============================================================================

create table public.process_change_events (
  id                uuid primary key default gen_random_uuid(),
  space_id          uuid not null references public.spaces (id) on delete cascade,
  process_id        uuid not null references public.processes (id) on delete cascade,
  source_kind       public.source_kind not null,
  event_type        public.tracking_event_type not null,
  movement_id       uuid references public.process_movements (id) on delete set null,
  occurred_at       timestamptz,
  detected_at       timestamptz not null default now(),
  collection_run_id uuid references public.collection_runs (id) on delete set null,
  payload           jsonb not null default '{}'::jsonb,
  consumed_at       timestamptz,
  created_at        timestamptz not null default now()
);

comment on table public.process_change_events is
  'Feed de eventos do detector. Consumido pela Fase de Notificações (não implementada aqui). is_first_sync nas movimentações garante que histórico retroativo não notifica.';

create index pce_process_detected_idx
  on public.process_change_events (process_id, detected_at desc);
create index pce_unconsumed_idx
  on public.process_change_events (detected_at) where consumed_at is null;
create index pce_space_detected_idx
  on public.process_change_events (space_id, detected_at desc);

create trigger pce_set_space
  before insert on public.process_change_events
  for each row execute function app.pts_set_space();

-- Imutável exceto `consumed_at` (a Fase de Notificações marca via SECURITY DEFINER).
create or replace function app.pce_block_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'process_change_events não pode ser apagado.' using errcode = 'restrict_violation';
  end if;
  if new.id is distinct from old.id
     or new.space_id is distinct from old.space_id
     or new.process_id is distinct from old.process_id
     or new.event_type is distinct from old.event_type
     or new.movement_id is distinct from old.movement_id
     or new.detected_at is distinct from old.detected_at
     or new.payload is distinct from old.payload then
    raise exception 'Só consumed_at pode mudar em process_change_events.' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
create trigger pce_guard_update
  before update on public.process_change_events
  for each row execute function app.pce_block_mutation();
create trigger pce_no_delete
  before delete on public.process_change_events
  for each row execute function app.pce_block_mutation();

alter table public.process_change_events enable row level security;
alter table public.process_change_events force row level security;

create policy pce_select
  on public.process_change_events for select to authenticated
  using (app.can_read_process(process_id));

grant select on public.process_change_events to authenticated;
revoke insert, update, delete on public.process_change_events from authenticated, anon;

-- ---------------------------------------------------------------------------
-- job_runs — monitoração dos sweeps do scheduler (nível plataforma)
-- ---------------------------------------------------------------------------
create table public.job_runs (
  id          uuid primary key default gen_random_uuid(),
  job_name    text not null,
  space_id    uuid references public.spaces (id) on delete set null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running',
  stats       jsonb not null default '{}'::jsonb,
  error       text,
  constraint job_runs_status_chk check (status in ('running', 'success', 'failed'))
);

create index job_runs_name_started_idx on public.job_runs (job_name, started_at desc);

alter table public.job_runs enable row level security;
alter table public.job_runs force row level security;

create policy job_runs_select
  on public.job_runs for select to authenticated
  using (app.is_super_admin());

grant select on public.job_runs to authenticated;
revoke insert, update, delete on public.job_runs from authenticated, anon;
