-- =============================================================================
-- 0008 — courts (catálogo global de tribunais/órgãos)
-- =============================================================================

create table public.courts (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  type         public.court_type not null,
  jurisdiction text not null,
  datajud_code text,
  active       boolean not null default true,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint courts_name_not_blank_chk check (length(btrim(name)) > 0),
  constraint courts_jurisdiction_not_blank_chk check (length(btrim(jurisdiction)) > 0)
);

comment on table public.courts is
  'Catálogo global de tribunais. Sem space_id. Escrita só SUPER_ADMIN; desativar via active.';

create unique index courts_datajud_code_uniq
  on public.courts (datajud_code) where datajud_code is not null;
create index courts_type_jurisdiction_idx on public.courts (type, jurisdiction);
create index courts_active_name_idx on public.courts (name) where active;

create trigger courts_set_updated_at
  before update on public.courts
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: leitura por qualquer autenticado; escrita só SUPER_ADMIN; sem DELETE.
-- ---------------------------------------------------------------------------
alter table public.courts enable row level security;
alter table public.courts force row level security;

create policy courts_select
  on public.courts for select
  to authenticated
  using (true);

create policy courts_insert
  on public.courts for insert
  to authenticated
  with check (app.is_super_admin());

create policy courts_update
  on public.courts for update
  to authenticated
  using (app.is_super_admin())
  with check (app.is_super_admin());

grant select, insert, update on public.courts to authenticated;
