-- =============================================================================
-- 0037 — Processo com N responsáveis + ciclo arquivar → excluir → restaurar.
--
-- Regras do produto:
--   - Todo processo tem ao menos 1 responsável.
--   - COLABORADOR pode cadastrar processo; ele próprio vira o responsável.
--   - ADMIN cadastra apontando um ou mais responsáveis e é o ÚNICO que
--     acrescenta/remove responsáveis.
--   - COLABORADOR vê, edita, vincula clientes e ARQUIVA os processos em que é
--     responsável. Não reativa, não encerra, não exclui.
--   - Ninguém exclui direto: só o ADMIN, e só processo já arquivado. Excluir
--     é lógico (o registro e a auditoria ficam) e pode ser desfeito (restaurar).
--
-- Modelo: `process_responsible_history` já guardava períodos de
-- responsabilidade; agora vários períodos podem estar abertos ao mesmo tempo
-- — os abertos são os responsáveis atuais. `processes.assigned_user_id`
-- (um responsável só) deixa de existir.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. notification_deliveries: um envio por (movimentação, responsável)
-- ---------------------------------------------------------------------------
alter table public.notification_deliveries
  add column recipient_profile_id uuid references public.profiles (id) on delete set null;

update public.notification_deliveries d
   set recipient_profile_id = p.assigned_user_id
  from public.processes p
 where p.id = d.process_id
   and d.recipient_type = 'responsible';

drop index public.notification_deliveries_responsible_uniq;
create unique index notification_deliveries_responsible_uniq
  on public.notification_deliveries (movement_id, recipient_profile_id)
  where recipient_type = 'responsible';

alter table public.notification_deliveries
  drop constraint notification_deliveries_client_id_chk,
  add constraint notification_deliveries_recipient_chk check (
    (recipient_type = 'client' and recipient_client_id is not null and recipient_profile_id is null)
    or (recipient_type = 'responsible' and recipient_client_id is null)
  );

-- ---------------------------------------------------------------------------
-- 2. Vários períodos abertos por processo (um por responsável)
-- ---------------------------------------------------------------------------
alter table public.process_responsible_history
  add column ended_by uuid references public.profiles (id) on delete set null;

drop index public.prh_one_open_period_uq;
create unique index prh_one_open_period_per_responsible_uq
  on public.process_responsible_history (process_id, responsible_id)
  where ended_at is null;

comment on table public.process_responsible_history is
  'Responsáveis do processo ao longo do tempo. Períodos abertos (ended_at null) = responsáveis atuais; um processo pode ter vários. Ledger: só se fecha um período (ended_at/ended_by), nunca se apaga.';

create or replace function app.prh_block_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'process_responsible_history é imutável (DELETE não permitido).'
      using errcode = 'restrict_violation';
  end if;
  if old.ended_at is not null then
    raise exception 'Período já encerrado; process_responsible_history é imutável.'
      using errcode = 'restrict_violation';
  end if;
  if new.id is distinct from old.id
     or new.space_id is distinct from old.space_id
     or new.process_id is distinct from old.process_id
     or new.responsible_id is distinct from old.responsible_id
     or new.assigned_by is distinct from old.assigned_by
     or new.reason is distinct from old.reason
     or new.started_at is distinct from old.started_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Só é permitido definir ended_at/ended_by em process_responsible_history.'
      using errcode = 'restrict_violation';
  end if;
  if new.ended_at is null then
    raise exception 'ended_at deve ser definido ao fechar o período.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function app.is_process_responsible(p_process uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.process_responsible_history h
    where h.process_id = p_process
      and h.responsible_id = (select auth.uid())
      and h.ended_at is null
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Leitura/edição: ADMIN do espaço ou um dos responsáveis atuais
-- ---------------------------------------------------------------------------
create or replace function app.can_read_process(p_process uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.processes p
    where p.id = p_process
      and p.deleted_at is null
      and (
        app.is_space_admin(p.space_id)
        or (app.is_active_member(p.space_id) and app.is_process_responsible(p.id))
      )
  );
$$;

-- Responsável (qualquer um deles) edita dados, vincula clientes e arquiva;
-- o que é só do ADMIN fica no gatilho processes_guard_field_updates.
create or replace function app.can_edit_process(p_process uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.can_read_process(p_process);
$$;

drop policy processes_select on public.processes;
drop policy processes_insert on public.processes;
drop policy processes_update on public.processes;

create policy processes_select
  on public.processes for select
  to authenticated
  using (
    deleted_at is null
    and (
      app.is_space_admin(space_id)
      or (app.is_active_member(space_id) and app.is_process_responsible(id))
    )
  );

create policy processes_update
  on public.processes for update
  to authenticated
  using (deleted_at is null and app.can_edit_process(id))
  with check (
    app.is_space_admin(space_id)
    or (app.is_active_member(space_id) and app.is_process_responsible(id))
  );

-- Colaborador vê quem são os corresponsáveis dos próprios processos.
drop policy prh_select on public.process_responsible_history;
create policy prh_select
  on public.process_responsible_history for select
  to authenticated
  using (app.is_space_admin(space_id) or app.can_read_process(process_id));

-- ---------------------------------------------------------------------------
-- 4. O que só o ADMIN faz num processo
-- ---------------------------------------------------------------------------
create or replace function app.processes_guard_field_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Worker/sistema (sem JWT) só grava colunas de acompanhamento.
  if (select auth.uid()) is null or app.is_space_admin(old.space_id) then
    return new;
  end if;

  if new.court_id is distinct from old.court_id then
    raise exception 'Alterar o tribunal é ação de ADMIN.' using errcode = 'insufficient_privilege';
  end if;
  if (new.status = 'closed') <> (old.status = 'closed') then
    raise exception 'Encerrar ou reabrir um processo é ação de ADMIN.'
      using errcode = 'insufficient_privilege';
  end if;
  if old.status = 'archived' and new.status = 'active' then
    raise exception 'Reativar um processo arquivado é ação de ADMIN.'
      using errcode = 'insufficient_privilege';
  end if;
  if new.deleted_at is distinct from old.deleted_at then
    raise exception 'Excluir processo é ação de ADMIN, a partir dos arquivados.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Sai o responsável único
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
  v_tracking_cols constant text[] := array[
    'last_state_hash', 'last_checked_at', 'last_check_error',
    'check_requested_at', 'check_requested_by', 'updated_at'
  ];
begin
  if app._audit_skip() then return null; end if;

  if tg_op = 'INSERT' then
    perform app.write_audit_log('process.create', new.space_id, 'process', new.id::text,
      'success', app._audit_actor(), null, to_jsonb(new), null);
    return null;
  end if;

  if (to_jsonb(old) - v_tracking_cols) = (to_jsonb(new) - v_tracking_cols) then
    return null;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    v_action := 'process.soft_delete';
  elsif old.deleted_at is not null and new.deleted_at is null then
    v_action := 'process.restore';
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

drop trigger processes_validate_assignee on public.processes;
drop function app.processes_validate_assignee();
drop trigger processes_open_first_period on public.processes;
drop function app.processes_open_first_period();
drop function public.transfer_process(uuid, uuid);

alter table public.processes drop column assigned_user_id;

-- Cadastro só pela RPC create_process (responsáveis gravados na mesma transação).
revoke insert on public.processes from authenticated;
revoke insert (id, space_id, created_by, court_id, cnj_number, internal_ref, status, tracking_enabled)
  on public.processes from authenticated;

-- ---------------------------------------------------------------------------
-- 6. RPCs
-- ---------------------------------------------------------------------------
create or replace function public.create_process(
  p_space_id        uuid,
  p_court_id        uuid,
  p_cnj_number      text,
  p_internal_ref    text,
  p_responsible_ids uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := (select auth.uid());
  v_ids uuid[];
  v_id  uuid;
  r     uuid;
begin
  if not app.is_active_member(p_space_id) then
    raise exception 'Sem acesso a este espaço.' using errcode = 'insufficient_privilege';
  end if;

  if app.is_space_admin(p_space_id) then
    select array_agg(distinct x) into v_ids from unnest(coalesce(p_responsible_ids, '{}')) x;
    if v_ids is null then
      raise exception 'Informe ao menos um responsável.' using errcode = 'check_violation';
    end if;
    foreach r in array v_ids loop
      if not app.is_active_member_of(p_space_id, r) then
        raise exception 'Todo responsável deve ser membro ativo do espaço.'
          using errcode = 'check_violation';
      end if;
    end loop;
  else
    -- Colaborador cadastra para si: ele é o responsável.
    if p_responsible_ids is not null
       and exists (select 1 from unnest(p_responsible_ids) x where x <> v_me) then
      raise exception 'Somente o ADMIN define os responsáveis de um processo.'
        using errcode = 'insufficient_privilege';
    end if;
    v_ids := array[v_me];
  end if;

  insert into public.processes (space_id, court_id, created_by, cnj_number, internal_ref)
  values (
    p_space_id, p_court_id, v_me,
    nullif(btrim(p_cnj_number), ''),
    nullif(btrim(p_internal_ref), '')
  )
  returning id into v_id;

  insert into public.process_responsible_history
    (process_id, responsible_id, assigned_by, reason, started_at)
  select v_id, x, v_me, 'process_created', now() from unnest(v_ids) x;

  perform app.write_audit_log(
    'process.responsible.add', p_space_id, 'process', v_id::text, 'success', 'user',
    null, jsonb_build_object('responsible_ids', to_jsonb(v_ids)),
    jsonb_build_object('reason', 'process_created')
  );
  return v_id;
end;
$$;

create or replace function public.add_process_responsible(p_process_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid;
begin
  select space_id into v_space from public.processes
   where id = p_process_id and deleted_at is null
   for update;
  if v_space is null then
    raise exception 'Processo não encontrado.' using errcode = 'no_data_found';
  end if;
  if not app.is_space_admin(v_space) then
    raise exception 'Somente o ADMIN altera os responsáveis de um processo.'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.is_active_member_of(v_space, p_profile_id) then
    raise exception 'Todo responsável deve ser membro ativo do espaço.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.process_responsible_history
             where process_id = p_process_id and responsible_id = p_profile_id and ended_at is null) then
    raise exception 'Este usuário já é responsável pelo processo.' using errcode = 'check_violation';
  end if;

  insert into public.process_responsible_history
    (process_id, responsible_id, assigned_by, reason, started_at)
  values (p_process_id, p_profile_id, (select auth.uid()), 'added', now());

  perform app.write_audit_log(
    'process.responsible.add', v_space, 'process', p_process_id::text, 'success', 'user',
    null, jsonb_build_object('responsible_id', p_profile_id), null
  );
end;
$$;

create or replace function public.remove_process_responsible(p_process_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid;
begin
  -- Trava o processo: duas remoções simultâneas não zeram os responsáveis.
  select space_id into v_space from public.processes
   where id = p_process_id and deleted_at is null
   for update;
  if v_space is null then
    raise exception 'Processo não encontrado.' using errcode = 'no_data_found';
  end if;
  if not app.is_space_admin(v_space) then
    raise exception 'Somente o ADMIN altera os responsáveis de um processo.'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.process_responsible_history
                 where process_id = p_process_id and responsible_id = p_profile_id and ended_at is null) then
    raise exception 'Este usuário não é responsável pelo processo.' using errcode = 'no_data_found';
  end if;
  if (select count(*) from public.process_responsible_history
      where process_id = p_process_id and ended_at is null) <= 1 then
    raise exception 'O processo precisa ter ao menos um responsável.' using errcode = 'check_violation';
  end if;

  update public.process_responsible_history
     set ended_at = now(), ended_by = (select auth.uid())
   where process_id = p_process_id and responsible_id = p_profile_id and ended_at is null;

  perform app.write_audit_log(
    'process.responsible.remove', v_space, 'process', p_process_id::text, 'success', 'user',
    jsonb_build_object('responsible_id', p_profile_id), null, null
  );
end;
$$;

-- Excluir: só ADMIN e só processo arquivado.
create or replace function public.soft_delete_process(p_process_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space  uuid;
  v_status public.process_status;
begin
  select space_id, status into v_space, v_status
    from public.processes
   where id = p_process_id and deleted_at is null
   for update;
  if v_space is null then
    raise exception 'Processo não encontrado.' using errcode = 'no_data_found';
  end if;
  if not app.is_space_admin(v_space) then
    raise exception 'Somente o ADMIN exclui processos.' using errcode = 'insufficient_privilege';
  end if;
  if v_status <> 'archived' then
    raise exception 'Arquive o processo antes de excluí-lo.' using errcode = 'check_violation';
  end if;
  update public.processes set deleted_at = now() where id = p_process_id;
end;
$$;

create or replace function public.restore_process(p_process_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid;
begin
  select space_id into v_space from public.processes
   where id = p_process_id and deleted_at is not null
   for update;
  if v_space is null then
    raise exception 'Processo excluído não encontrado.' using errcode = 'no_data_found';
  end if;
  if not app.is_space_admin(v_space) then
    raise exception 'Somente o ADMIN restaura processos.' using errcode = 'insufficient_privilege';
  end if;
  -- Volta para os arquivados; o limite do plano é checado no gatilho.
  update public.processes set deleted_at = null where id = p_process_id;
end;
$$;

create or replace function public.list_deleted_processes(p_space_id uuid)
returns table (
  id           uuid,
  cnj_number   text,
  internal_ref text,
  court_name   text,
  deleted_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_space_admin(p_space_id) then
    raise exception 'Somente o ADMIN vê os processos excluídos.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select p.id, p.cnj_number::text, p.internal_ref, c.name, p.deleted_at
    from public.processes p
    join public.courts c on c.id = p.court_id
    where p.space_id = p_space_id and p.deleted_at is not null
    order by p.deleted_at desc;
end;
$$;

revoke execute on function public.create_process(uuid, uuid, text, text, uuid[]) from public;
revoke execute on function public.add_process_responsible(uuid, uuid) from public;
revoke execute on function public.remove_process_responsible(uuid, uuid) from public;
revoke execute on function public.restore_process(uuid) from public;
revoke execute on function public.list_deleted_processes(uuid) from public;
grant execute on function public.create_process(uuid, uuid, text, text, uuid[]) to authenticated;
grant execute on function public.add_process_responsible(uuid, uuid) to authenticated;
grant execute on function public.remove_process_responsible(uuid, uuid) to authenticated;
grant execute on function public.restore_process(uuid) to authenticated;
grant execute on function public.list_deleted_processes(uuid) to authenticated;
