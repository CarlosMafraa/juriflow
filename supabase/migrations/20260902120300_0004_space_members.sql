-- =============================================================================
-- 0004 — space_members + helpers de autorização
-- =============================================================================

create type public.space_role as enum ('ADMIN', 'COLABORADOR');
create type public.space_member_status as enum ('active', 'invited', 'disabled');

create table public.space_members (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  role        public.space_role not null,
  status      public.space_member_status not null default 'active',
  invited_by  uuid references public.profiles (id) on delete set null,
  invited_at  timestamptz,
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  constraint space_members_unique unique (space_id, profile_id)
);

comment on table public.space_members is
  'Vínculo usuário<->espaço com papel. SUPER_ADMIN NÃO aparece aqui (é papel de plataforma).';

create index space_members_space_role_idx
  on public.space_members (space_id, role)
  where status = 'active';
create index space_members_profile_idx on public.space_members (profile_id);

create trigger space_members_set_updated_at
  before update on public.space_members
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Helpers de autorização (SECURITY DEFINER — leem sem passar por RLS).
-- São a base para TODAS as políticas. Nunca duplicar checagem de papel em SQL
-- fora daqui. Espelham packages/domain (ADR-0003).
-- ---------------------------------------------------------------------------
create or replace function app.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_super_admin from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

create or replace function app.role_in_space(target_space uuid)
returns public.space_role
language sql
stable
security definer
set search_path = ''
as $$
  select sm.role
  from public.space_members sm
  where sm.space_id = target_space
    and sm.profile_id = (select auth.uid())
    and sm.status = 'active'
  limit 1;
$$;

create or replace function app.is_active_member(target_space uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.space_members sm
    where sm.space_id = target_space
      and sm.profile_id = (select auth.uid())
      and sm.status = 'active'
  );
$$;

create or replace function app.is_space_admin(target_space uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.role_in_space(target_space) = 'ADMIN';
$$;

create or replace function app.shares_space_with(other_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.space_members me
    join public.space_members them on them.space_id = me.space_id
    where me.profile_id = (select auth.uid())
      and me.status = 'active'
      and them.profile_id = other_profile
      and them.status = 'active'
  );
$$;

-- ---------------------------------------------------------------------------
-- Invariante: um espaço nunca fica sem ADMIN ativo (RT-03 / DP-09).
-- ---------------------------------------------------------------------------
create or replace function app.prevent_last_space_admin_loss()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid := old.space_id;
  v_other_admins int;
  v_losing_admin boolean;
begin
  v_losing_admin :=
    old.role = 'ADMIN' and old.status = 'active'
    and (
      tg_op = 'DELETE'
      or new.role <> 'ADMIN'
      or new.status <> 'active'
    );

  if not v_losing_admin then
    return coalesce(new, old);
  end if;

  select count(*) into v_other_admins
  from public.space_members
  where space_id = v_space
    and role = 'ADMIN'
    and status = 'active'
    and id <> old.id;

  if v_other_admins = 0 then
    raise exception 'Um espaço deve manter ao menos um ADMIN ativo (space_id=%).', v_space
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger space_members_guard_last_admin
  before update or delete on public.space_members
  for each row execute function app.prevent_last_space_admin_loss();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.space_members enable row level security;
alter table public.space_members force row level security;

-- SELECT: qualquer membro ativo vê a lista de membros do próprio espaço;
-- SUPER_ADMIN vê todos (provisionamento — DP-35).
create policy space_members_select
  on public.space_members for select
  to authenticated
  using (app.is_super_admin() or app.is_active_member(space_id));

-- INSERT: ADMIN do espaço ou SUPER_ADMIN. (Fluxo de convite com token = DP-09.)
create policy space_members_insert
  on public.space_members for insert
  to authenticated
  with check (app.is_super_admin() or app.is_space_admin(space_id));

-- UPDATE: ADMIN do espaço ou SUPER_ADMIN (trigger protege o último ADMIN).
create policy space_members_update
  on public.space_members for update
  to authenticated
  using (app.is_super_admin() or app.is_space_admin(space_id))
  with check (app.is_super_admin() or app.is_space_admin(space_id));

-- DELETE: ADMIN do espaço ou SUPER_ADMIN (trigger protege o último ADMIN).
create policy space_members_delete
  on public.space_members for delete
  to authenticated
  using (app.is_super_admin() or app.is_space_admin(space_id));
