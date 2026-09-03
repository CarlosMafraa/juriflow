-- =============================================================================
-- 0011 — Fase 3: helpers de autorização de processo + políticas + triggers de regra
-- Separação aprovada (rev. 3):
--   LER   processo = ADMIN do espaço OU responsável atual (assigned_user_id)
--   EDITAR processo = ADMIN do espaço OU (criador E ainda responsável atual)  [Q7 = SIM]
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function app.is_active_member_of(p_space uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.space_members sm
    where sm.space_id = p_space
      and sm.profile_id = p_profile
      and sm.status = 'active'
  );
$$;

create or replace function app.can_read_process(p_process uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.processes p
    where p.id = p_process
      and p.deleted_at is null
      and (
        app.is_space_admin(p.space_id)
        or (
          app.is_active_member(p.space_id)
          and p.assigned_user_id = (select auth.uid())
        )
      )
  );
$$;

-- Q7 = SIM: o criador só edita enquanto TAMBÉM for o responsável atual.
create or replace function app.can_edit_process(p_process uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.processes p
    where p.id = p_process
      and p.deleted_at is null
      and (
        app.is_space_admin(p.space_id)
        or (
          p.created_by = (select auth.uid())
          and app.is_active_member(p.space_id)
          and p.assigned_user_id = (select auth.uid())
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Triggers de regra (BEFORE)
-- ---------------------------------------------------------------------------
create or replace function app.processes_validate_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_active_member_of(new.space_id, new.assigned_user_id) then
    raise exception 'O responsável (assigned_user_id) deve ser um membro ativo do espaço.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger processes_validate_assignee
  before insert or update of assigned_user_id on public.processes
  for each row execute function app.processes_validate_assignee();

create or replace function app.processes_validate_court()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.courts c where c.id = new.court_id and c.active
  ) then
    raise exception 'Tribunal inexistente ou inativo.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger processes_validate_court
  before insert or update of court_id on public.processes
  for each row execute function app.processes_validate_court();

-- Não-ADMIN (o criador editando) não pode: trocar responsável, trocar tribunal,
-- encerrar/reabrir. active↔archived é permitido.
create or replace function app.processes_guard_field_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.is_space_admin(old.space_id) then
    return new;
  end if;

  if new.assigned_user_id is distinct from old.assigned_user_id then
    raise exception 'Transferência de responsável é ação de ADMIN (use transfer_process).'
      using errcode = 'insufficient_privilege';
  end if;
  if new.court_id is distinct from old.court_id then
    raise exception 'Alterar o tribunal é ação de ADMIN.' using errcode = 'insufficient_privilege';
  end if;
  if (new.status = 'closed') <> (old.status = 'closed') then
    raise exception 'Encerrar ou reabrir um processo é ação de ADMIN.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger processes_guard_field_updates
  before update on public.processes
  for each row execute function app.processes_guard_field_updates();

-- ---------------------------------------------------------------------------
-- AFTER INSERT: abre o 1º período de responsabilidade
-- ---------------------------------------------------------------------------
create or replace function app.processes_open_first_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.process_responsible_history
    (process_id, responsible_id, assigned_by, reason, started_at, ended_at)
  values
    (new.id, new.assigned_user_id, new.created_by, 'process_created', now(), null);
  return null;
end;
$$;

create trigger processes_open_first_period
  after insert on public.processes
  for each row execute function app.processes_open_first_period();

-- ---------------------------------------------------------------------------
-- Políticas RLS
-- ---------------------------------------------------------------------------
create policy processes_select
  on public.processes for select
  to authenticated
  using (
    deleted_at is null
    and (
      app.is_space_admin(space_id)
      or (app.is_active_member(space_id) and assigned_user_id = (select auth.uid()))
    )
  );

create policy processes_insert
  on public.processes for insert
  to authenticated
  with check (
    deleted_at is null
    and app.is_active_member(space_id)
    and created_by = (select auth.uid())
    and (
      app.is_space_admin(space_id)
      or assigned_user_id = (select auth.uid())
    )
  );

create policy processes_update
  on public.processes for update
  to authenticated
  using (deleted_at is null and app.can_edit_process(id))
  with check (
    app.is_space_admin(space_id)
    or (
      created_by = (select auth.uid())
      and app.is_active_member(space_id)
      and assigned_user_id = (select auth.uid())
    )
  );
-- Sem DELETE: soft delete via app.soft_delete_process (0015).
