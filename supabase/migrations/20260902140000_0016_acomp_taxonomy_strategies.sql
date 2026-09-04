-- =============================================================================
-- 0016 — Acompanhamento-A: enums, taxonomia de movimentos, estratégias por tribunal
-- Aditivo. Nada em processes/courts da Fase 3 é alterado.
-- =============================================================================

create type public.collection_run_status as enum ('pending', 'running', 'success', 'partial', 'failed');
create type public.collection_error_code as enum (
  'timeout', 'unavailable', 'rate_limited', 'auth_failed', 'parse_error', 'not_found', 'unknown'
);
create type public.collection_trigger as enum ('scheduled', 'manual', 'retry');
create type public.tracking_event_type as enum ('new_movement', 'movement_amended', 'first_sync_completed');

-- `source_kind` é texto (union aberto do @juriflow/collectors-core). Só validamos o formato;
-- a validade real é existir uma court_tracking_strategies habilitada para o tribunal.
create domain public.source_kind as text
  check (value ~ '^[a-z][a-z0-9_]{1,39}$');

-- ---------------------------------------------------------------------------
-- movement_categories — taxonomia mínima (referência TPU/CNJ). Catálogo global.
-- O catálogo completo entra na Fase 4 (Tribunais/DataJud estrutural).
-- ---------------------------------------------------------------------------
create table public.movement_categories (
  code        text primary key,
  label       text not null,
  parent_code text references public.movement_categories (code) on delete set null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint movement_categories_label_not_blank_chk check (length(btrim(label)) > 0)
);

comment on table public.movement_categories is
  'Taxonomia canônica de movimentos (mínima nesta fase). Catálogo global sem space_id.';

alter table public.movement_categories enable row level security;
alter table public.movement_categories force row level security;

create policy movement_categories_select
  on public.movement_categories for select to authenticated using (true);
create policy movement_categories_write
  on public.movement_categories for all to authenticated
  using (app.is_super_admin()) with check (app.is_super_admin());

grant select, insert, update, delete on public.movement_categories to authenticated;

-- Semente mínima (movimentos mais comuns). Códigos = TPU/CNJ.
insert into public.movement_categories (code, label) values
  ('26',   'Distribuição'),
  ('123',  'Conclusão'),
  ('60',   'Expedição de documento'),
  ('11010','Recebimento'),
  ('51',   'Audiência'),
  ('193',  'Decisão'),
  ('11009','Mero expediente'),
  ('219',  'Publicação'),
  ('132',  'Juntada'),
  ('466',  'Baixa definitiva'),
  ('246',  'Definitivo'),
  ('848',  'Sentença'),
  ('12266','Determinação'),
  ('581',  'Ato ordinatório praticado'),
  ('85',   'Petição'),
  ('893',  'Julgamento')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- court_tracking_strategies — configuração GLOBAL de fontes por tribunal.
-- Gerida pelo SUPER_ADMIN. O ADMIN do espaço só habilita/desabilita por processo.
-- ---------------------------------------------------------------------------
create table public.court_tracking_strategies (
  id           uuid primary key default gen_random_uuid(),
  court_id     uuid not null references public.courts (id) on delete cascade,
  source_kind  public.source_kind not null,
  priority     int not null default 100,
  params       jsonb not null default '{}'::jsonb,
  requires_cnj boolean not null default true,
  enabled      boolean not null default true,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint cts_court_source_uniq unique (court_id, source_kind)
);

comment on table public.court_tracking_strategies is
  'Fontes de acompanhamento disponíveis por tribunal. SUPER_ADMIN gerencia. Nenhum adapter real na Acompanhamento-A.';

create index cts_court_enabled_idx
  on public.court_tracking_strategies (court_id, priority) where enabled;

create trigger cts_set_updated_at
  before update on public.court_tracking_strategies
  for each row execute function app.set_updated_at();

alter table public.court_tracking_strategies enable row level security;
alter table public.court_tracking_strategies force row level security;

create policy cts_select
  on public.court_tracking_strategies for select to authenticated using (true);
create policy cts_write
  on public.court_tracking_strategies for all to authenticated
  using (app.is_super_admin()) with check (app.is_super_admin());

grant select, insert, update, delete on public.court_tracking_strategies to authenticated;
