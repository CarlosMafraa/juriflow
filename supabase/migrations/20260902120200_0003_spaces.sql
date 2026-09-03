-- =============================================================================
-- 0003 — spaces (tenant)
-- =============================================================================

create type public.space_status as enum ('active', 'suspended');

create table public.spaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null,
  status     public.space_status not null default 'active',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint spaces_slug_unique unique (slug),
  constraint spaces_slug_format_chk check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint spaces_name_not_blank_chk check (length(btrim(name)) > 0)
);

comment on table public.spaces is 'Tenant. Isolamento operacional é por spaces.id (space_id).';

create index spaces_status_idx on public.spaces (status);

create trigger spaces_set_updated_at
  before update on public.spaces
  for each row execute function app.set_updated_at();

alter table public.spaces enable row level security;
alter table public.spaces force row level security;
-- Políticas em 0005 (dependem de space_members / helpers).
