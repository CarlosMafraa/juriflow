-- =============================================================================
-- 0012 — clients (PF/PJ). Soft delete via app.soft_delete_client (0015, anonimiza).
-- =============================================================================

create table public.clients (
  id                  uuid primary key default gen_random_uuid(),
  space_id            uuid not null references public.spaces (id) on delete cascade,
  type                public.client_type not null,
  name                text not null,
  document            extensions.citext,
  email               extensions.citext,
  phone               text,
  birth_date          date,
  notification_opt_in boolean not null default false,
  opt_in_at           timestamptz,
  created_by          uuid not null references public.profiles (id) on delete restrict,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz,
  deleted_at          timestamptz,
  constraint clients_name_not_blank_chk check (length(btrim(name)) > 0),
  constraint clients_birth_date_pf_chk check (birth_date is null or type = 'PF'),
  constraint clients_document_digits_chk check (document is null or document::text ~ '^\d+$'),
  constraint clients_document_len_chk check (
    document is null
    or (type = 'PF' and length(document::text) = 11)
    or (type = 'PJ' and length(document::text) = 14)
  ),
  constraint clients_phone_e164_chk check (phone is null or phone ~ '^\+[1-9]\d{6,14}$'),
  constraint clients_email_format_chk check (
    email is null or email::text ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  constraint clients_opt_in_requires_date_chk check (
    notification_opt_in = false or opt_in_at is not null
  )
);

comment on table public.clients is
  'Cliente PF/PJ do escritório. Não é usuário. Soft delete = anonimização (app.soft_delete_client).';

create unique index clients_document_uniq
  on public.clients (space_id, document)
  where document is not null and deleted_at is null;
create index clients_space_idx on public.clients (space_id) where deleted_at is null;
create index clients_space_type_idx on public.clients (space_id, type) where deleted_at is null;
create index clients_name_trgm_idx
  on public.clients using gin (name extensions.gin_trgm_ops) where deleted_at is null;
create index clients_space_email_idx
  on public.clients (space_id, email) where email is not null and deleted_at is null;
create index clients_space_phone_idx
  on public.clients (space_id, phone) where phone is not null and deleted_at is null;
create index clients_space_birthdate_idx
  on public.clients (space_id, birth_date) where type = 'PF' and deleted_at is null;

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function app.set_updated_at();

-- Normaliza documento para só dígitos (a unicidade nunca depende da formatação digitada).
create or replace function app.clients_normalize_document()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.document := nullif(regexp_replace(coalesce(new.document::text, ''), '\D', '', 'g'), '')::extensions.citext;
  return new;
end;
$$;

create trigger clients_normalize_document
  before insert or update of document on public.clients
  for each row execute function app.clients_normalize_document();

create or replace function app.clients_protect_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.space_id is distinct from old.space_id then
    raise exception 'clients.space_id é imutável.' using errcode = 'check_violation';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'clients.created_by é imutável.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger clients_protect_immutable
  before update on public.clients
  for each row execute function app.clients_protect_immutable();

-- ---------------------------------------------------------------------------
-- RLS: leitura = qualquer membro ativo do espaço; escrita = ADMIN ou criador;
-- soft delete só via RPC (a política de UPDATE proíbe setar deleted_at direto).
-- ---------------------------------------------------------------------------
alter table public.clients enable row level security;
alter table public.clients force row level security;

create policy clients_select
  on public.clients for select
  to authenticated
  using (deleted_at is null and app.is_active_member(space_id));

create policy clients_insert
  on public.clients for insert
  to authenticated
  with check (
    deleted_at is null
    and app.is_active_member(space_id)
    and created_by = (select auth.uid())
  );

create policy clients_update
  on public.clients for update
  to authenticated
  using (
    deleted_at is null
    and (app.is_space_admin(space_id) or created_by = (select auth.uid()))
  )
  with check (
    deleted_at is null
    and (app.is_space_admin(space_id) or created_by = (select auth.uid()))
  );

grant select, insert, update on public.clients to authenticated;
