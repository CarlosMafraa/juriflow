-- =============================================================================
-- 0013 — process_clients (vínculo N:N processo↔cliente; SEM papel processual)
-- =============================================================================

create table public.process_clients (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references public.spaces (id) on delete cascade,
  process_id uuid not null references public.processes (id) on delete cascade,
  client_id  uuid not null references public.clients (id) on delete restrict,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  deleted_at timestamptz
);

comment on table public.process_clients is
  'Apenas "este cliente está ligado a este processo". Sem role/role_note.';

create unique index process_clients_active_uq
  on public.process_clients (process_id, client_id) where deleted_at is null;
create index process_clients_process_idx
  on public.process_clients (process_id) where deleted_at is null;
create index process_clients_client_idx
  on public.process_clients (client_id) where deleted_at is null;
create index process_clients_space_idx on public.process_clients (space_id);

create trigger process_clients_set_updated_at
  before update on public.process_clients
  for each row execute function app.set_updated_at();

-- Valida tenant no vínculo e deriva space_id do processo (só no INSERT).
create or replace function app.pc_validate_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p_space   uuid;
  v_p_deleted timestamptz;
  v_c_space   uuid;
  v_c_deleted timestamptz;
begin
  select space_id, deleted_at into v_p_space, v_p_deleted
    from public.processes where id = new.process_id;
  select space_id, deleted_at into v_c_space, v_c_deleted
    from public.clients where id = new.client_id;

  if v_p_space is null then
    raise exception 'Processo inexistente.' using errcode = 'foreign_key_violation';
  end if;
  if v_c_space is null then
    raise exception 'Cliente inexistente.' using errcode = 'foreign_key_violation';
  end if;
  if v_p_space <> v_c_space then
    raise exception 'Processo e cliente devem pertencer ao mesmo espaço.'
      using errcode = 'check_violation';
  end if;
  if v_p_deleted is not null or v_c_deleted is not null then
    raise exception 'Não é possível vincular processo ou cliente excluído.'
      using errcode = 'check_violation';
  end if;

  new.space_id := v_p_space;
  return new;
end;
$$;

create trigger pc_validate_tenant
  before insert on public.process_clients
  for each row execute function app.pc_validate_tenant();

create or replace function app.pc_protect_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.space_id is distinct from old.space_id
     or new.process_id is distinct from old.process_id
     or new.client_id is distinct from old.client_id
     or new.created_by is distinct from old.created_by then
    raise exception 'process_clients: só deleted_at pode mudar após a criação.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger pc_protect_immutable
  before update on public.process_clients
  for each row execute function app.pc_protect_immutable();

-- ---------------------------------------------------------------------------
-- RLS: LER o vínculo = ler o processo; vincular/desvincular = editar o processo.
-- ---------------------------------------------------------------------------
alter table public.process_clients enable row level security;
alter table public.process_clients force row level security;

create policy process_clients_select
  on public.process_clients for select
  to authenticated
  using (deleted_at is null and app.can_read_process(process_id));

create policy process_clients_insert
  on public.process_clients for insert
  to authenticated
  with check (
    app.can_edit_process(process_id)
    and created_by = (select auth.uid())
  );

create policy process_clients_update
  on public.process_clients for update
  to authenticated
  using (deleted_at is null and app.can_edit_process(process_id))
  with check (app.can_edit_process(process_id));

grant select, insert, update on public.process_clients to authenticated;
