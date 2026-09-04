-- =============================================================================
-- 0018 — Acompanhamento-A: collection_runs (log de execução) + payload bruto
-- Escrito apenas por RPCs SECURITY DEFINER. Leitura por quem lê o processo.
-- =============================================================================

create table public.collection_runs (
  id                 uuid primary key default gen_random_uuid(),
  space_id           uuid not null references public.spaces (id) on delete cascade,
  process_id         uuid not null references public.processes (id) on delete cascade,
  tracking_config_id uuid references public.process_tracking_configs (id) on delete set null,
  source_kind        public.source_kind not null,
  trigger            public.collection_trigger not null,
  status             public.collection_run_status not null default 'pending',
  attempt            int not null default 1,
  requested_by       uuid references public.profiles (id) on delete set null,
  queued_at          timestamptz not null default now(),
  started_at         timestamptz,
  finished_at        timestamptz,
  duration_ms        int,
  movements_fetched  int,
  movements_new      int,
  movements_updated  int,
  state_hash_before  text,
  state_hash_after   text,
  error_code         public.collection_error_code,
  error_message      text,
  http_status        int,
  next_retry_at      timestamptz,
  created_at         timestamptz not null default now(),
  constraint collection_runs_attempt_chk check (attempt between 1 and 5)
);

comment on table public.collection_runs is
  'Uma linha por execução de coleta (scheduled/manual/retry). É o log de execução do acompanhamento.';

-- LOCK: no máximo uma execução em andamento por (processo, fonte).
create unique index collection_runs_running_uniq
  on public.collection_runs (process_id, source_kind) where status = 'running';
create index collection_runs_claim_idx
  on public.collection_runs (queued_at) where status = 'pending';
create index collection_runs_process_idx
  on public.collection_runs (process_id, source_kind, created_at desc);
create index collection_runs_space_created_idx
  on public.collection_runs (space_id, created_at desc);
create index collection_runs_config_idx on public.collection_runs (tracking_config_id);

create trigger collection_runs_set_space
  before insert on public.collection_runs
  for each row execute function app.pts_set_space();

alter table public.collection_runs enable row level security;
alter table public.collection_runs force row level security;

create policy collection_runs_select
  on public.collection_runs for select to authenticated
  using (app.can_read_process(process_id));

grant select on public.collection_runs to authenticated;
revoke insert, update, delete on public.collection_runs from authenticated, anon;

-- ---------------------------------------------------------------------------
-- collection_raw_payloads — resposta bruta da fonte (MVP em tabela jsonb).
-- Contém dados pessoais → mesma RLS das movimentações. Retenção: ver DP (não
-- implementada nesta fase; prune será rotina separada).
-- ---------------------------------------------------------------------------
create table public.collection_raw_payloads (
  id                uuid primary key default gen_random_uuid(),
  space_id          uuid not null references public.spaces (id) on delete cascade,
  process_id        uuid not null references public.processes (id) on delete cascade,
  collection_run_id uuid not null references public.collection_runs (id) on delete cascade,
  source_kind       public.source_kind not null,
  payload           jsonb not null,
  byte_size         int,
  created_at        timestamptz not null default now(),
  constraint crp_run_uniq unique (collection_run_id)
);

create index crp_process_idx on public.collection_raw_payloads (process_id, created_at desc);

alter table public.collection_raw_payloads enable row level security;
alter table public.collection_raw_payloads force row level security;

create policy crp_select
  on public.collection_raw_payloads for select to authenticated
  using (app.can_read_process(process_id));

grant select on public.collection_raw_payloads to authenticated;
revoke insert, update, delete on public.collection_raw_payloads from authenticated, anon;
