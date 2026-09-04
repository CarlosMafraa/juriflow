-- =============================================================================
-- 0021 — Acompanhamento-A: elegibilidade, scheduler, RPCs de configuração,
--        coleta manual, e as RPCs de runtime (claim / submit) para o tick.
-- Nenhum adapter real. Nenhuma chamada externa. Nenhum worker.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- GUC de privilégio: as RPCs confiáveis marcam para o gatilho de guarda liberar
-- campos de configuração. UPDATE direto de cliente não tem esse GUC.
-- ---------------------------------------------------------------------------
create or replace function app.ptc_guard_field_updates()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.space_id is distinct from old.space_id
     or new.process_id is distinct from old.process_id
     or new.created_by is distinct from old.created_by then
    raise exception 'process_tracking_configs: space_id/process_id/created_by são imutáveis.'
      using errcode = 'check_violation';
  end if;

  if coalesce(current_setting('app.tracking_privileged', true), '') = 'on' then
    return new;
  end if;
  if app.is_space_admin(old.space_id) then
    return new;
  end if;

  -- Não-ADMIN sem privilégio: UPDATE direto não é permitido (use as RPCs).
  raise exception 'Alterações no acompanhamento são feitas pelas ações da tela (RPC), não por edição direta.'
    using errcode = 'insufficient_privilege';
end;
$$;

-- ---------------------------------------------------------------------------
-- Elegibilidade — configs prontas para coleta (testável isoladamente)
-- ---------------------------------------------------------------------------
create or replace function app.tracking_due_config_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.process_tracking_configs c
  join public.processes p on p.id = c.process_id
  join public.court_tracking_strategies s on s.id = c.court_strategy_id
  where c.enabled
    and c.paused_at is null
    and c.next_run_at is not null
    and c.next_run_at <= now()
    and p.status = 'active'
    and p.deleted_at is null
    and (p.cnj_number is not null or not s.requires_cnj)
    and not exists (
      select 1 from public.collection_runs r
      where r.process_id = c.process_id and r.source_kind = c.source_kind
        and r.status in ('pending', 'running')
    );
$$;

-- ---------------------------------------------------------------------------
-- Sweep — entrypoint do pg_cron. Enfileira collection_runs 'pending'.
-- ---------------------------------------------------------------------------
create or replace function app.tracking_sweep()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job uuid;
  v_ids uuid[];
  v_id uuid;
  v_queued int := 0;
begin
  insert into public.job_runs (job_name, status) values ('tracking_sweep', 'running') returning id into v_job;
  v_ids := array(select app.tracking_due_config_ids());

  if array_length(v_ids, 1) is not null then
    foreach v_id in array v_ids loop
      insert into public.collection_runs (process_id, tracking_config_id, source_kind, trigger, status, attempt)
      select c.process_id, c.id, c.source_kind, 'scheduled', 'pending', 1
        from public.process_tracking_configs c where c.id = v_id;

      update public.process_tracking_configs
        set next_run_at = app.compute_next_run_at(frequency, schedule_time, timezone)
        where id = v_id;
      v_queued := v_queued + 1;
    end loop;
  end if;

  update public.job_runs
    set finished_at = now(), status = 'success',
        stats = jsonb_build_object('due', coalesce(array_length(v_ids, 1), 0), 'queued', v_queued)
    where id = v_job;
exception when others then
  update public.job_runs set finished_at = now(), status = 'failed', error = sqlerrm where id = v_job;
  raise;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: habilitar/desabilitar acompanhamento de uma fonte (ADMIN ou responsável)
-- ---------------------------------------------------------------------------
create or replace function public.set_process_tracking(
  p_process_id uuid,
  p_source_kind public.source_kind,
  p_enabled boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid;
  v_court uuid;
  v_strategy uuid;
  v_config uuid;
begin
  select space_id, court_id into v_space, v_court
    from public.processes where id = p_process_id and deleted_at is null;
  if v_space is null then
    raise exception 'Processo não encontrado.' using errcode = 'no_data_found';
  end if;
  if not app.can_read_process(p_process_id) then
    raise exception 'Sem acesso a este processo.' using errcode = 'insufficient_privilege';
  end if;

  select id into v_strategy from public.court_tracking_strategies
    where court_id = v_court and source_kind = p_source_kind and enabled;
  if v_strategy is null then
    raise exception 'Fonte "%" não está disponível para o tribunal deste processo.', p_source_kind
      using errcode = 'check_violation';
  end if;

  perform set_config('app.tracking_privileged', 'on', true);

  select id into v_config from public.process_tracking_configs
    where process_id = p_process_id and source_kind = p_source_kind;

  if v_config is null then
    insert into public.process_tracking_configs (process_id, source_kind, enabled, created_by)
    values (p_process_id, p_source_kind, p_enabled, (select auth.uid()))
    returning id into v_config;
  else
    update public.process_tracking_configs
      set enabled = p_enabled,
          consecutive_failures = case when p_enabled then 0 else consecutive_failures end,
          paused_at            = case when p_enabled then null else paused_at end,
          pause_reason         = case when p_enabled then null else pause_reason end,
          next_run_at          = case when p_enabled
                                   then app.compute_next_run_at(frequency, schedule_time, timezone)
                                   else next_run_at end
      where id = v_config;
  end if;

  perform app.write_audit_log(
    case when p_enabled then 'tracking.enable' else 'tracking.disable' end,
    v_space, 'process_tracking_config', v_config::text, 'success', 'user',
    null,
    jsonb_build_object('process_id', p_process_id, 'source_kind', p_source_kind, 'enabled', p_enabled),
    null);

  perform set_config('app.tracking_privileged', 'off', true);
  return v_config;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: configurar frequência/parâmetros (ADMIN apenas)
-- ---------------------------------------------------------------------------
create or replace function public.configure_process_tracking(
  p_config_id uuid,
  p_frequency interval default null,
  p_schedule_time time default null,
  p_timezone text default null,
  p_source_params jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid;
begin
  select space_id into v_space from public.process_tracking_configs where id = p_config_id;
  if v_space is null then
    raise exception 'Configuração não encontrada.' using errcode = 'no_data_found';
  end if;
  if not app.is_space_admin(v_space) then
    raise exception 'Somente ADMIN configura o acompanhamento.' using errcode = 'insufficient_privilege';
  end if;

  perform set_config('app.tracking_privileged', 'on', true);
  update public.process_tracking_configs
    set frequency     = coalesce(p_frequency, frequency),
        schedule_time = coalesce(p_schedule_time, schedule_time),
        timezone      = coalesce(p_timezone, timezone),
        source_params = coalesce(p_source_params, source_params),
        next_run_at   = app.compute_next_run_at(
                          coalesce(p_frequency, frequency),
                          coalesce(p_schedule_time, schedule_time),
                          coalesce(p_timezone, timezone))
    where id = p_config_id;

  perform app.write_audit_log('tracking.configure', v_space, 'process_tracking_config',
    p_config_id::text, 'success', 'user', null,
    jsonb_build_object('frequency', p_frequency, 'schedule_time', p_schedule_time,
      'timezone', p_timezone, 'source_params', p_source_params), null);
  perform set_config('app.tracking_privileged', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: coleta manual "coletar agora" (ADMIN ou responsável)
-- ---------------------------------------------------------------------------
create or replace function public.collect_process_now(
  p_process_id uuid,
  p_source_kind public.source_kind
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid;
  v_court uuid;
  v_status public.process_status;
  v_config uuid;
  v_run uuid;
begin
  select space_id, court_id, status into v_space, v_court, v_status
    from public.processes where id = p_process_id and deleted_at is null;
  if v_space is null then
    raise exception 'Processo não encontrado.' using errcode = 'no_data_found';
  end if;
  if not app.can_read_process(p_process_id) then
    raise exception 'Sem acesso a este processo.' using errcode = 'insufficient_privilege';
  end if;
  if v_status <> 'active' then
    raise exception 'Só processos ativos podem ser coletados.' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.court_tracking_strategies
    where court_id = v_court and source_kind = p_source_kind and enabled
  ) then
    raise exception 'Fonte "%" não está disponível para o tribunal deste processo.', p_source_kind
      using errcode = 'check_violation';
  end if;

  select id into v_config from public.process_tracking_configs
    where process_id = p_process_id and source_kind = p_source_kind and enabled;
  if v_config is null then
    raise exception 'Habilite o acompanhamento dessa fonte antes de coletar.'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.collection_runs
    where process_id = p_process_id and source_kind = p_source_kind and status in ('pending', 'running')
  ) then
    raise exception 'Já existe uma coleta em andamento ou na fila para essa fonte.'
      using errcode = 'unique_violation';
  end if;

  insert into public.collection_runs (process_id, tracking_config_id, source_kind, trigger, status, attempt, requested_by)
  values (p_process_id, v_config, p_source_kind, 'manual', 'pending', 1, (select auth.uid()))
  returning id into v_run;

  perform app.write_audit_log('tracking.manual_collect', v_space, 'collection_run', v_run::text,
    'success', 'user', null, jsonb_build_object('process_id', p_process_id, 'source_kind', p_source_kind), null);

  return v_run;
end;
$$;

-- ---------------------------------------------------------------------------
-- RUNTIME (service_role): claim + submit. É o que o tick/worker chama.
-- Nenhuma lógica de fonte aqui — só persistência do que o motor (TS) calculou.
-- ---------------------------------------------------------------------------
create or replace function public.claim_pending_collection_run()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.collection_runs;
  v_proc public.processes;
  v_cfg public.process_tracking_configs;
  v_state public.process_tracking_state;
  v_known jsonb;
begin
  select r.* into v_run
  from public.collection_runs r
  join public.process_tracking_configs c on c.id = r.tracking_config_id
  where r.status = 'pending'
    and r.queued_at <= now()
    and c.paused_at is null
    and not exists (
      select 1 from public.collection_runs r2
      where r2.process_id = r.process_id and r2.source_kind = r.source_kind and r2.status = 'running'
    )
  order by r.queued_at
  limit 1
  for update of r skip locked;

  if v_run.id is null then
    return null;
  end if;

  update public.collection_runs set status = 'running', started_at = now() where id = v_run.id;

  select * into v_proc from public.processes where id = v_run.process_id;
  select * into v_cfg from public.process_tracking_configs where id = v_run.tracking_config_id;
  select * into v_state from public.process_tracking_state
    where process_id = v_run.process_id and source_kind = v_run.source_kind;

  select coalesce(jsonb_agg(jsonb_build_object(
           'content_hash', m.content_hash, 'source_movement_id', m.source_movement_id)), '[]'::jsonb)
    into v_known
    from public.process_movements m
    where m.process_id = v_run.process_id and m.source_kind = v_run.source_kind;

  return jsonb_build_object(
    'run_id', v_run.id,
    'process_id', v_run.process_id,
    'space_id', v_run.space_id,
    'source_kind', v_run.source_kind,
    'trigger', v_run.trigger,
    'attempt', v_run.attempt,
    'cnj_number', v_proc.cnj_number,
    'court_id', v_proc.court_id,
    'source_params', coalesce(v_cfg.source_params, '{}'::jsonb),
    'is_first_sync', not coalesce(v_state.first_sync_done, false),
    'since', case
               when v_state.last_movement_occurred_at is null then null
               else to_char(v_state.last_movement_occurred_at - interval '7 days',
                            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'state_hash_before', v_state.state_hash,
    'known', v_known
  );
end;
$$;

create or replace function public.submit_collection_result(p_run_id uuid, p_result jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.collection_runs;
  v_status public.collection_run_status := (p_result->>'status')::public.collection_run_status;
  v_first_sync_completed boolean := coalesce((p_result->>'first_sync_completed')::boolean, false);
  m jsonb;
  e jsonb;
  v_mid uuid;
  v_max_occurred timestamptz;
begin
  select * into v_run from public.collection_runs where id = p_run_id for update;
  if v_run.id is null or v_run.status <> 'running' then
    raise exception 'Execução % não está em andamento.', p_run_id using errcode = 'check_violation';
  end if;

  insert into public.collection_raw_payloads (space_id, process_id, collection_run_id, source_kind, payload, byte_size)
  values (v_run.space_id, v_run.process_id, v_run.id, v_run.source_kind,
          coalesce(p_result->'raw_payload', 'null'::jsonb),
          length(coalesce(p_result->>'raw_payload', '')));

  for m in select * from jsonb_array_elements(coalesce(p_result->'movements', '[]'::jsonb)) loop
    insert into public.process_movements (
      process_id, source_kind, source_movement_id, occurred_at, category_code, category_label,
      description, raw, content_hash, is_first_sync, needs_review, revision_of, collection_run_id)
    values (
      v_run.process_id, v_run.source_kind,
      nullif(m->>'source_movement_id', ''),
      (m->>'occurred_at')::timestamptz,
      nullif(m->>'category_code', ''),
      nullif(m->>'category_label', ''),
      coalesce(m->>'description', ''),
      coalesce(m->'raw', 'null'::jsonb),
      m->>'content_hash',
      coalesce((m->>'is_first_sync')::boolean, false),
      coalesce((m->>'needs_review')::boolean, false),
      (select id from public.process_movements pm
         where pm.process_id = v_run.process_id and pm.source_kind = v_run.source_kind
           and pm.content_hash = nullif(m->>'revises_content_hash', '')),
      v_run.id)
    on conflict (process_id, source_kind, content_hash) do nothing;
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p_result->'events', '[]'::jsonb)) loop
    v_mid := (select id from public.process_movements pm
              where pm.process_id = v_run.process_id and pm.source_kind = v_run.source_kind
                and pm.content_hash = nullif(e->>'content_hash', ''));
    insert into public.process_change_events (
      process_id, source_kind, event_type, movement_id, occurred_at, collection_run_id, payload)
    values (
      v_run.process_id, v_run.source_kind, (e->>'event_type')::public.tracking_event_type,
      v_mid, (e->>'occurred_at')::timestamptz, v_run.id, coalesce(e->'payload', '{}'::jsonb));
  end loop;

  if v_status = 'success' then
    select max(occurred_at) into v_max_occurred
      from public.process_movements
      where process_id = v_run.process_id and source_kind = v_run.source_kind;

    insert into public.process_tracking_state
      (process_id, source_kind, state_hash, first_sync_done, last_synced_at, last_movement_occurred_at)
    values
      (v_run.process_id, v_run.source_kind, p_result->>'state_hash', v_first_sync_completed, now(), v_max_occurred)
    on conflict (process_id, source_kind) do update
      set state_hash = excluded.state_hash,
          first_sync_done = public.process_tracking_state.first_sync_done or v_first_sync_completed,
          last_synced_at = now(),
          last_movement_occurred_at = greatest(
            public.process_tracking_state.last_movement_occurred_at, excluded.last_movement_occurred_at);
  end if;

  update public.collection_runs
    set status = v_status,
        finished_at = now(),
        duration_ms = greatest(0, (extract(epoch from (now() - coalesce(started_at, now()))) * 1000)::int),
        movements_fetched = coalesce((p_result#>>'{counts,fetched}')::int, 0),
        movements_new     = coalesce((p_result#>>'{counts,new}')::int, 0),
        movements_updated = coalesce((p_result#>>'{counts,updated}')::int, 0),
        state_hash_before = v_run.state_hash_before,
        state_hash_after  = case when v_status = 'success' then p_result->>'state_hash' else null end,
        error_code        = nullif(p_result->>'error_code', '')::public.collection_error_code,
        error_message     = nullif(p_result->>'error_message', '')
    where id = p_run_id;

  perform set_config('app.tracking_privileged', 'on', true);
  update public.process_tracking_configs
    set last_run_at = now(),
        last_run_status = v_status,
        consecutive_failures = case when v_status = 'success' then 0 else consecutive_failures end,
        paused_at    = case when v_status = 'success' then null else paused_at end,
        pause_reason = case when v_status = 'success' then null else pause_reason end
    where id = v_run.tracking_config_id;
  perform set_config('app.tracking_privileged', 'off', true);
end;
$$;

create or replace function public.submit_collection_failure(p_run_id uuid, p_error jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.collection_runs;
  v_space uuid;
  v_failures int;
  v_retriable boolean := coalesce((p_error->>'retriable')::boolean, false);
  v_backoff interval;
begin
  select * into v_run from public.collection_runs where id = p_run_id for update;
  if v_run.id is null or v_run.status <> 'running' then
    raise exception 'Execução % não está em andamento.', p_run_id using errcode = 'check_violation';
  end if;
  v_space := v_run.space_id;

  update public.collection_runs
    set status = 'failed', finished_at = now(),
        duration_ms = greatest(0, (extract(epoch from (now() - coalesce(started_at, now()))) * 1000)::int),
        error_code = nullif(p_error->>'error_code', '')::public.collection_error_code,
        error_message = nullif(p_error->>'error_message', ''),
        http_status = nullif(p_error->>'http_status', '')::int
    where id = p_run_id;

  perform set_config('app.tracking_privileged', 'on', true);
  update public.process_tracking_configs
    set consecutive_failures = consecutive_failures + 1,
        last_run_at = now(), last_run_status = 'failed'
    where id = v_run.tracking_config_id
    returning consecutive_failures into v_failures;

  if v_failures >= 5 then
    update public.process_tracking_configs
      set enabled = false, paused_at = now(), pause_reason = 'consecutive_failures'
      where id = v_run.tracking_config_id;
    update public.collection_runs
      set status = 'failed', finished_at = coalesce(finished_at, now()),
          error_code = 'unknown', error_message = 'Acompanhamento auto-pausado após 5 falhas consecutivas.'
      where tracking_config_id = v_run.tracking_config_id and status = 'pending';
    perform app.write_audit_log('tracking.auto_paused', v_space, 'process_tracking_config',
      v_run.tracking_config_id::text, 'failure', 'system', null,
      jsonb_build_object('consecutive_failures', v_failures, 'source_kind', v_run.source_kind), null);
  elsif v_retriable and v_run.attempt < 5 then
    v_backoff := case v_run.attempt
      when 1 then interval '5 minutes'
      when 2 then interval '15 minutes'
      when 3 then interval '1 hour'
      when 4 then interval '3 hours'
      else interval '6 hours' end;
    update public.collection_runs set next_retry_at = now() + v_backoff where id = p_run_id;
    insert into public.collection_runs
      (process_id, tracking_config_id, source_kind, trigger, status, attempt, queued_at)
    values
      (v_run.process_id, v_run.tracking_config_id, v_run.source_kind, 'retry', 'pending',
       v_run.attempt + 1, now() + v_backoff);
  end if;
  perform set_config('app.tracking_privileged', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
revoke execute on function public.set_process_tracking(uuid, public.source_kind, boolean) from public;
revoke execute on function public.configure_process_tracking(uuid, interval, time, text, jsonb) from public;
revoke execute on function public.collect_process_now(uuid, public.source_kind) from public;
grant execute on function public.set_process_tracking(uuid, public.source_kind, boolean) to authenticated;
grant execute on function public.configure_process_tracking(uuid, interval, time, text, jsonb) to authenticated;
grant execute on function public.collect_process_now(uuid, public.source_kind) to authenticated;

revoke execute on function public.claim_pending_collection_run() from public;
revoke execute on function public.submit_collection_result(uuid, jsonb) from public;
revoke execute on function public.submit_collection_failure(uuid, jsonb) from public;
grant execute on function public.claim_pending_collection_run() to service_role;
grant execute on function public.submit_collection_result(uuid, jsonb) to service_role;
grant execute on function public.submit_collection_failure(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Agendamento (pg_cron) — guardado: se a extensão não estiver disponível no
-- ambiente, as funções continuam existindo e podem ser chamadas manualmente.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('juriflow-tracking-sweep', '*/10 * * * *', 'select app.tracking_sweep()');
  else
    raise notice 'pg_cron indisponível — o sweep deve ser acionado manualmente (app.tracking_sweep()).';
  end if;
exception when others then
  raise notice 'Não foi possível agendar o sweep via pg_cron: %', sqlerrm;
end;
$$;
