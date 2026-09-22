-- =============================================================================
-- 0016 — MVP Acompanhamento: process_movements (histórico, append-only por natureza)
-- Escrita só pelo scraper-worker (service_role, bypassa RLS). RLS aqui protege
-- a leitura por usuários autenticados (uso futuro do frontend).
-- =============================================================================

create table public.process_movements (
  id               uuid primary key default gen_random_uuid(),
  space_id         uuid not null references public.spaces (id) on delete cascade,
  process_id       uuid not null references public.processes (id) on delete cascade,
  source_kind      text not null,
  source_movement_id text,
  description      text not null,
  occurred_at      timestamptz,
  collected_at     timestamptz not null default now(),
  raw              jsonb not null default '{}'::jsonb,
  content_hash     text not null,
  created_at       timestamptz not null default now(),
  constraint process_movements_source_kind_not_blank_chk check (length(btrim(source_kind)) > 0),
  constraint process_movements_description_not_blank_chk check (length(btrim(description)) > 0)
);

comment on table public.process_movements is
  'Histórico de movimentações processuais coletadas. Nunca sobrescrito; deduplicado por content_hash (RN16).';
comment on column public.process_movements.content_hash is
  'Hash determinístico da movimentação (fonte + id/descrição + data), usado para deduplicação entre coletas.';
comment on column public.process_movements.occurred_at is
  'Data em que a movimentação ocorreu no tribunal — distinta de collected_at (quando o sistema tomou conhecimento).';

create unique index process_movements_process_hash_uniq
  on public.process_movements (process_id, content_hash);
create index process_movements_process_occurred_idx
  on public.process_movements (process_id, occurred_at desc);
create index process_movements_space_idx on public.process_movements (space_id);

-- ---------------------------------------------------------------------------
-- RLS: mesma visibilidade de processes (app.can_read_process, já existe — 0011).
-- Sem INSERT/UPDATE/DELETE para authenticated/anon: só o worker (service_role).
-- ---------------------------------------------------------------------------
alter table public.process_movements enable row level security;
alter table public.process_movements force row level security;

create policy process_movements_select
  on public.process_movements for select
  to authenticated
  using (app.can_read_process(process_id));

grant select on public.process_movements to authenticated;
revoke insert, update, delete on public.process_movements from authenticated, anon;
