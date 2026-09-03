-- =============================================================================
-- 0014 — Fase 3: auditoria via gatilhos AFTER (usa app.write_audit_log — infra da Fase 2)
-- Operações multi-passo (transfer_process, soft_delete_*) definem
-- `set local app.skip_row_audit = 'on'` e registram o verbo específico elas mesmas.
-- =============================================================================

create or replace function app.audit_diff(p_old jsonb, p_new jsonb)
returns table (before jsonb, after jsonb)
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
  v_before jsonb := '{}'::jsonb;
  v_after  jsonb := '{}'::jsonb;
begin
  for k in select jsonb_object_keys(p_new) loop
    if (p_old -> k) is distinct from (p_new -> k) then
      v_before := v_before || jsonb_build_object(k, p_old -> k);
      v_after  := v_after  || jsonb_build_object(k, p_new -> k);
    end if;
  end loop;
  before := v_before;
  after  := v_after;
  return next;
end;
$$;

create or replace function app._audit_skip()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('app.skip_row_audit', true), '') = 'on';
$$;

create or replace function app._audit_actor()
returns public.audit_actor_type
language sql
stable
set search_path = ''
as $$
  select case when (select auth.uid()) is null then 'system'::public.audit_actor_type
              else 'user'::public.audit_actor_type end;
$$;

-- ---------------------------------------------------------------------------
-- courts (ações de plataforma → space_id null)
-- ---------------------------------------------------------------------------
create or replace function app.audit_courts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  d record;
begin
  if app._audit_skip() then return null; end if;

  if tg_op = 'INSERT' then
    perform app.write_audit_log('court.create', null, 'court', new.id::text,
      'success', app._audit_actor(), null, to_jsonb(new), null);
    return null;
  end if;

  if new.active is distinct from old.active then
    v_action := case when new.active then 'court.activate' else 'court.deactivate' end;
  else
    v_action := 'court.update';
  end if;
  select * into d from app.audit_diff(to_jsonb(old), to_jsonb(new));
  perform app.write_audit_log(v_action, null, 'court', new.id::text,
    'success', app._audit_actor(), d.before, d.after, null);
  return null;
end;
$$;

create trigger zz_audit_courts
  after insert or update on public.courts
  for each row execute function app.audit_courts();

-- ---------------------------------------------------------------------------
-- processes
-- ---------------------------------------------------------------------------
create or replace function app.audit_processes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  d record;
begin
  if app._audit_skip() then return null; end if;

  if tg_op = 'INSERT' then
    perform app.write_audit_log('process.create', new.space_id, 'process', new.id::text,
      'success', app._audit_actor(), null, to_jsonb(new), null);
    return null;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    v_action := 'process.soft_delete';
  elsif new.assigned_user_id is distinct from old.assigned_user_id then
    v_action := 'process.transfer';
  elsif new.status is distinct from old.status then
    v_action := case
      when new.status = 'archived' then 'process.archive'
      when new.status = 'active' and old.status in ('archived', 'closed') then 'process.reactivate'
      when new.status = 'closed' then 'process.close'
      else 'process.update'
    end;
  else
    v_action := 'process.update';
  end if;

  select * into d from app.audit_diff(to_jsonb(old), to_jsonb(new));
  perform app.write_audit_log(v_action, new.space_id, 'process', new.id::text,
    'success', app._audit_actor(), d.before, d.after, null);
  return null;
end;
$$;

create trigger zz_audit_processes
  after insert or update on public.processes
  for each row execute function app.audit_processes();

-- ---------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------
create or replace function app.audit_clients()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
begin
  if app._audit_skip() then return null; end if;

  if tg_op = 'INSERT' then
    perform app.write_audit_log('client.create', new.space_id, 'client', new.id::text,
      'success', app._audit_actor(), null, to_jsonb(new), null);
    return null;
  end if;

  select * into d from app.audit_diff(to_jsonb(old), to_jsonb(new));
  perform app.write_audit_log('client.update', new.space_id, 'client', new.id::text,
    'success', app._audit_actor(), d.before, d.after, null);
  return null;
end;
$$;

create trigger zz_audit_clients
  after insert or update on public.clients
  for each row execute function app.audit_clients();

-- ---------------------------------------------------------------------------
-- process_clients
-- ---------------------------------------------------------------------------
create or replace function app.audit_process_clients()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if app._audit_skip() then return null; end if;

  if tg_op = 'INSERT' then
    v_action := 'process.client.attach';
  elsif old.deleted_at is null and new.deleted_at is not null then
    v_action := 'process.client.detach';
  else
    v_action := 'process.client.update';
  end if;

  perform app.write_audit_log(v_action, new.space_id, 'process_client', new.id::text,
    'success', app._audit_actor(),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new), jsonb_build_object('process_id', new.process_id, 'client_id', new.client_id));
  return null;
end;
$$;

create trigger zz_audit_process_clients
  after insert or update on public.process_clients
  for each row execute function app.audit_process_clients();
