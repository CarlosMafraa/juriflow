-- =============================================================================
-- 0015 — Fase 3: RPCs (public, SECURITY DEFINER) — operações atômicas/sensíveis
-- =============================================================================

-- ---------------------------------------------------------------------------
-- transfer_process — troca o responsável atual (ADMIN). Atômico.
-- ---------------------------------------------------------------------------
create or replace function public.transfer_process(
  p_process_id uuid,
  p_new_assigned_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space   uuid;
  v_current uuid;
  v_deleted timestamptz;
begin
  select space_id, assigned_user_id, deleted_at
    into v_space, v_current, v_deleted
    from public.processes
    where id = p_process_id
    for update;

  if v_space is null or v_deleted is not null then
    raise exception 'Processo não encontrado.' using errcode = 'no_data_found';
  end if;
  if not app.is_space_admin(v_space) then
    raise exception 'Apenas ADMIN do espaço pode transferir processos.'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.is_active_member_of(v_space, p_new_assigned_user_id) then
    raise exception 'O novo responsável deve ser um membro ativo do espaço.'
      using errcode = 'check_violation';
  end if;
  if p_new_assigned_user_id = v_current then
    raise exception 'O usuário já é o responsável atual.' using errcode = 'check_violation';
  end if;

  set local app.skip_row_audit = 'on';

  update public.process_responsible_history
    set ended_at = now()
    where process_id = p_process_id and ended_at is null;

  insert into public.process_responsible_history
    (process_id, responsible_id, assigned_by, reason, started_at, ended_at)
  values
    (p_process_id, p_new_assigned_user_id, (select auth.uid()), 'transfer', now(), null);

  update public.processes
    set assigned_user_id = p_new_assigned_user_id
    where id = p_process_id;

  perform app.write_audit_log(
    'process.transfer', v_space, 'process', p_process_id::text, 'success', 'user',
    jsonb_build_object('assigned_user_id', v_current),
    jsonb_build_object('assigned_user_id', p_new_assigned_user_id),
    jsonb_build_object('reason', 'transfer')
  );

  -- Reabilita explicitamente o gatilho de auditoria para o restante da transação.
  perform set_config('app.skip_row_audit', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- soft_delete_process — exclusão lógica (ADMIN ou criador ainda responsável).
-- ---------------------------------------------------------------------------
create or replace function public.soft_delete_process(p_process_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exists boolean;
begin
  select true into v_exists
    from public.processes
    where id = p_process_id and deleted_at is null
    for update;

  if not coalesce(v_exists, false) then
    raise exception 'Processo não encontrado.' using errcode = 'no_data_found';
  end if;
  if not app.can_edit_process(p_process_id) then
    raise exception 'Sem permissão para excluir este processo.'
      using errcode = 'insufficient_privilege';
  end if;

  -- O gatilho de auditoria detecta deleted_at null→not null e registra process.soft_delete.
  update public.processes set deleted_at = now() where id = p_process_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- soft_delete_client — exclusão lógica + anonimização de PII (ADMIN ou criador).
-- ---------------------------------------------------------------------------
create or replace function public.soft_delete_client(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space      uuid;
  v_created_by uuid;
  v_deleted    timestamptz;
begin
  select space_id, created_by, deleted_at
    into v_space, v_created_by, v_deleted
    from public.clients
    where id = p_client_id
    for update;

  if v_space is null or v_deleted is not null then
    raise exception 'Cliente não encontrado.' using errcode = 'no_data_found';
  end if;
  if not (app.is_space_admin(v_space) or v_created_by = (select auth.uid())) then
    raise exception 'Sem permissão para excluir este cliente.'
      using errcode = 'insufficient_privilege';
  end if;

  set local app.skip_row_audit = 'on';

  update public.clients
    set deleted_at = now(),
        name = 'Cliente removido',
        document = null,
        email = null,
        phone = null,
        birth_date = null,
        notification_opt_in = false,
        opt_in_at = null
    where id = p_client_id;

  perform app.write_audit_log(
    'client.soft_delete', v_space, 'client', p_client_id::text, 'success', 'user',
    jsonb_build_object('anonymized', true), null, null
  );

  perform set_config('app.skip_row_audit', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões: só usuários autenticados executam.
-- ---------------------------------------------------------------------------
revoke execute on function public.transfer_process(uuid, uuid) from public;
revoke execute on function public.soft_delete_process(uuid) from public;
revoke execute on function public.soft_delete_client(uuid) from public;
grant execute on function public.transfer_process(uuid, uuid) to authenticated;
grant execute on function public.soft_delete_process(uuid) to authenticated;
grant execute on function public.soft_delete_client(uuid) to authenticated;
