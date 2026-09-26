-- =============================================================================
-- 0032 — "Consultar agora" (RN seção 39) sem expor o worker na internet.
--
-- Mesmo padrão de whatsapp_sessions (0026): o usuário só grava a INTENÇÃO via
-- RPC; o scraper-worker (service_role) faz polling de `check_requested_at`,
-- executa a coleta e limpa o pedido. O endpoint HTTP do worker continua
-- sem porta pública.
-- =============================================================================

alter table public.processes
  add column check_requested_at timestamptz,
  add column check_requested_by uuid references public.profiles (id) on delete set null;

comment on column public.processes.check_requested_at is
  'Pedido de consulta manual pendente (RN seção 39). O worker processa e volta para NULL.';

create index processes_check_requested_idx
  on public.processes (check_requested_at)
  where check_requested_at is not null;

-- Intervalo mínimo entre consultas manuais do mesmo processo: protege a fonte
-- (Projudi) de cliques repetidos e o worker de fila acumulada.
create or replace function public.request_process_check(p_process_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proc   public.processes;
  v_source text;
begin
  if not app.can_read_process(p_process_id) then
    raise exception 'Processo não encontrado ou sem acesso.' using errcode = '42501';
  end if;

  select * into v_proc from public.processes where id = p_process_id for update;

  if v_proc.status <> 'active' then
    raise exception 'Somente processos ativos podem ser consultados.' using errcode = 'check_violation';
  end if;
  -- Consulta manual faz parte da sincronização: sem ela, contornaria o limite do plano.
  if not v_proc.tracking_enabled then
    raise exception 'Ligue a sincronização automática para consultar este processo no tribunal.'
      using errcode = 'check_violation';
  end if;
  if v_proc.cnj_number is null then
    raise exception 'Informe o número CNJ para consultar o processo.' using errcode = 'check_violation';
  end if;

  select c.tracking_source_kind into v_source from public.courts c where c.id = v_proc.court_id;
  if v_source is null then
    raise exception 'Este tribunal ainda não tem consulta automática.' using errcode = 'check_violation';
  end if;

  -- Já na fila: idempotente, não duplica pedido.
  if v_proc.check_requested_at is not null then
    return v_proc.check_requested_at;
  end if;

  if v_proc.last_checked_at is not null and v_proc.last_checked_at > now() - interval '5 minutes' then
    raise exception 'Este processo foi consultado há menos de 5 minutos. Aguarde para consultar novamente.'
      using errcode = 'check_violation';
  end if;

  set local app.skip_row_audit = 'on';
  update public.processes
     set check_requested_at = now(),
         check_requested_by = (select auth.uid())
   where id = p_process_id;
  perform set_config('app.skip_row_audit', 'off', true);

  perform app.write_audit_log(
    'process.check.request', v_proc.space_id, 'process', p_process_id::text,
    'success', 'user', null, null, null
  );

  return now();
end;
$$;

revoke execute on function public.request_process_check(uuid) from public;
grant execute on function public.request_process_check(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Auditoria de processes: atualizações feitas SÓ nas colunas de
-- acompanhamento (worker diário, fila de consulta) não são alteração de
-- negócio — antes geravam um `process.update` por processo por dia. A coleta
-- em si já é auditada em process.movement.collected / notification.delivery.*.
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

-- ---------------------------------------------------------------------------
-- Colunas de acompanhamento pertencem ao worker (service_role) e à RPC acima.
-- Antes, o UPDATE de tabela inteira deixava o usuário gravar direto
-- `check_requested_at` (furando o intervalo mínimo) ou `last_state_hash`
-- (mascarando movimentações novas). UPDATE passa a ser por coluna.
-- ---------------------------------------------------------------------------
revoke update on public.processes from authenticated;
grant update (cnj_number, internal_ref, court_id, assigned_user_id, status, deleted_at, tracking_enabled)
  on public.processes to authenticated;

-- Mesmo motivo no INSERT: um processo criado já com `last_state_hash` forjado
-- faria a 1ª coleta tratar todo o histórico como novidade e disparar WhatsApp
-- para os clientes de cada movimentação antiga.
revoke insert on public.processes from authenticated;
grant insert (id, space_id, created_by, assigned_user_id, court_id, cnj_number, internal_ref, status, tracking_enabled)
  on public.processes to authenticated;
