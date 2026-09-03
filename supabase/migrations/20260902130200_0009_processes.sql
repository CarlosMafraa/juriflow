-- =============================================================================
-- 0009 — processes (estrutura). Helpers, políticas e triggers de regra: 0011.
-- =============================================================================

create table public.processes (
  id               uuid primary key default gen_random_uuid(),
  space_id         uuid not null references public.spaces (id) on delete cascade,
  cnj_number       extensions.citext,
  internal_ref     text,
  court_id         uuid not null references public.courts (id) on delete restrict,
  assigned_user_id uuid not null references public.profiles (id) on delete restrict,
  created_by       uuid not null references public.profiles (id) on delete restrict,
  status           public.process_status not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz,
  deleted_at       timestamptz,
  constraint processes_cnj_format_chk check (
    cnj_number is null
    or cnj_number ~ '^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$'
  ),
  constraint processes_internal_ref_not_blank_chk check (
    internal_ref is null or length(btrim(internal_ref)) > 0
  )
);

comment on table public.processes is
  'Processo jurídico. assigned_user_id = responsável atual (acompanhamento); created_by = quem cadastrou (imutável, base da permissão de edição).';
comment on column public.processes.assigned_user_id is
  'Usuário atualmente responsável. Troca só via app.transfer_process (ADMIN).';

create unique index processes_cnj_uniq
  on public.processes (space_id, cnj_number)
  where cnj_number is not null and deleted_at is null;

create index processes_space_assignee_idx
  on public.processes (space_id, assigned_user_id) where deleted_at is null;
create index processes_space_status_idx
  on public.processes (space_id, status) where deleted_at is null;
create index processes_space_created_idx
  on public.processes (space_id, created_at desc) where deleted_at is null;
create index processes_court_idx on public.processes (court_id);
create index processes_internal_ref_trgm_idx
  on public.processes using gin (internal_ref extensions.gin_trgm_ops)
  where deleted_at is null;

create trigger processes_set_updated_at
  before update on public.processes
  for each row execute function app.set_updated_at();

-- created_by e space_id são imutáveis.
create or replace function app.processes_protect_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.space_id is distinct from old.space_id then
    raise exception 'processes.space_id é imutável.' using errcode = 'check_violation';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'processes.created_by é imutável.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger processes_protect_immutable
  before update on public.processes
  for each row execute function app.processes_protect_immutable();

alter table public.processes enable row level security;
alter table public.processes force row level security;
grant select, insert, update on public.processes to authenticated;
