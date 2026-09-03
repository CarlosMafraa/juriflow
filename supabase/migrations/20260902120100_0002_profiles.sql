-- =============================================================================
-- 0002 — profiles (1:1 com auth.users)
-- =============================================================================

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  full_name     text,
  email         extensions.citext not null,
  phone         text,
  is_super_admin boolean not null default false,
  avatar_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  constraint profiles_email_unique unique (email),
  constraint profiles_phone_e164_chk check (phone is null or phone ~ '^\+[1-9]\d{6,14}$')
);

comment on table public.profiles is 'Identidade do usuário. 1:1 com auth.users.';
comment on column public.profiles.is_super_admin is
  'Papel de PLATAFORMA (global). Não é papel de espaço. Ver ADR-0003 / DP-11.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function app.set_updated_at();

-- Provisionamento automático do profile ao criar um auth.users.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

-- SELECT: o próprio usuário. Políticas adicionais (colegas de espaço,
-- SUPER_ADMIN) são adicionadas em 0005, depois que space_members existe.
create policy profiles_select_self
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

-- INSERT: só o próprio id (o trigger security definer também insere).
create policy profiles_insert_self
  on public.profiles for insert
  to authenticated
  with check (id = (select auth.uid()));

-- UPDATE: só o próprio perfil. A imutabilidade de `is_super_admin` para não-super
-- é garantida por gatilho (app.protect_super_admin_flag, migration 0005) — evita
-- subconsulta a `profiles` dentro da própria policy (recursão de RLS).
create policy profiles_update_self
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
