-- =============================================================================
-- 0019 — Acompanhamento-A: process_movements (histórico canônico, append-only)
-- =============================================================================

create table public.process_movements (
  id                 uuid primary key default gen_random_uuid(),
  space_id           uuid not null references public.spaces (id) on delete cascade,
  process_id         uuid not null references public.processes (id) on delete cascade,
  source_kind        public.source_kind not null,
  source_movement_id text,
  occurred_at        timestamptz,
  collected_at       timestamptz not null default now(),
  category_code      text references public.movement_categories (code) on delete set null,
  category_label     text,
  description        text not null default '',
  raw                jsonb not null,
  content_hash       text not null,
  is_first_sync      boolean not null default false,
  needs_review       boolean not null default false,
  revision_of        uuid references public.process_movements (id) on delete set null,
  collection_run_id  uuid references public.collection_runs (id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint process_movements_content_uniq unique (process_id, source_kind, content_hash)
);

comment on table public.process_movements is
  'Histórico canônico de movimentações. Append-only: sem UPDATE/DELETE. Revisão de texto = nova linha com revision_of.';

create index process_movements_process_occurred_idx
  on public.process_movements (process_id, occurred_at desc nulls last);
create index process_movements_process_source_idx
  on public.process_movements (process_id, source_kind);
create index process_movements_space_collected_idx
  on public.process_movements (space_id, collected_at desc);
create index process_movements_needs_review_idx
  on public.process_movements (process_id) where needs_review;

create trigger process_movements_set_space
  before insert on public.process_movements
  for each row execute function app.pts_set_space();

-- Append-only.
create or replace function app.process_movements_block_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'process_movements é append-only: % não é permitido.', tg_op
    using errcode = 'restrict_violation';
end;
$$;
create trigger process_movements_no_update
  before update on public.process_movements
  for each row execute function app.process_movements_block_mutation();
create trigger process_movements_no_delete
  before delete on public.process_movements
  for each row execute function app.process_movements_block_mutation();

alter table public.process_movements enable row level security;
alter table public.process_movements force row level security;

create policy process_movements_select
  on public.process_movements for select to authenticated
  using (app.can_read_process(process_id));

grant select on public.process_movements to authenticated;
revoke insert, update, delete on public.process_movements from authenticated, anon;
