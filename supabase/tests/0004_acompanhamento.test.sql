-- =============================================================================
-- Acompanhamento-A — configs, estratégias, elegibilidade, lock, coleta manual,
-- runtime (claim/submit), idempotência, 1ª sync, amended, parcial, retry,
-- auto-pausa, RLS e auditoria.
-- =============================================================================
begin;
select * from no_plan();

create function tests_as(uid uuid) returns void
language sql security definer set search_path = '' as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
$$;
create function tests_service() returns void
language sql security definer set search_path = '' as $$
  select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
$$;
create function tests_rowcount(stmt text) returns int
language plpgsql as $$ declare n int; begin execute stmt; get diagnostics n = row_count; return n; end; $$;

-- ---- usuários / espaços / membros ----
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a1','authenticated','authenticated','adminA@t','x',now(),now(),now(),'{}','{"full_name":"Admin A"}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a2','authenticated','authenticated','colabA1@t','x',now(),now(),now(),'{}','{"full_name":"Colab A1"}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a3','authenticated','authenticated','colabA2@t','x',now(),now(),now(),'{}','{"full_name":"Colab A2"}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000b1','authenticated','authenticated','adminB@t','x',now(),now(),now(),'{}','{"full_name":"Admin B"}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000f1','authenticated','authenticated','super@t','x',now(),now(),now(),'{}','{"full_name":"Super"}');
update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-0000000000f1';

insert into public.spaces (id, name, slug) values
 ('10000000-0000-0000-0000-00000000000a','Escritorio A','escritorio-a'),
 ('10000000-0000-0000-0000-00000000000b','Escritorio B','escritorio-b');
insert into public.space_members (space_id, profile_id, role, status) values
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a1','ADMIN','active'),
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a2','COLABORADOR','active'),
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a3','COLABORADOR','active'),
 ('10000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000b1','ADMIN','active');

insert into public.courts (id, name, type, jurisdiction, active) values
 ('20000000-0000-0000-0000-000000000001','TJAM','TJ','AM', true);

-- estratégias globais do tribunal (SUPER_ADMIN gere)
insert into public.court_tracking_strategies (court_id, source_kind, requires_cnj, enabled) values
 ('20000000-0000-0000-0000-000000000001','datajud', true,  true),
 ('20000000-0000-0000-0000-000000000001','scraper',  false, true);

-- processos
insert into public.processes (id, space_id, court_id, assigned_user_id, created_by, cnj_number, status) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a2','0000001-23.2024.8.04.0001','active'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a1',null,'active'),
 ('30000000-0000-0000-0000-0000000000f0','10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a2','0000009-99.2024.8.04.0001','active'),
 ('30000000-0000-0000-0000-00000000a0a0','10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a2','0000002-23.2024.8.04.0001','archived');

-- =============================================================================
-- Configuração de acompanhamento
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a2'); set local role authenticated;
select lives_ok($$ select public.set_process_tracking('30000000-0000-0000-0000-000000000001','datajud',true) $$,
  'Responsável habilita acompanhamento (datajud) do próprio processo');
select is((select count(*)::int from public.process_tracking_configs
  where process_id='30000000-0000-0000-0000-000000000001'), 1, 'Config criada');
select is((select enabled from public.process_tracking_configs
  where process_id='30000000-0000-0000-0000-000000000001' and source_kind='datajud'), true, 'Config habilitada');

select tests_as('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$ select public.set_process_tracking('30000000-0000-0000-0000-000000000001','datajud',true) $$,
  '42501', null, 'COLABORADOR que não é responsável não configura o processo');

select tests_as('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.set_process_tracking('30000000-0000-0000-0000-000000000001','scraper',true) $$,
  'ADMIN habilita uma segunda fonte no mesmo processo');
select is((select count(*)::int from public.process_tracking_configs
  where process_id='30000000-0000-0000-0000-000000000001'), 2, 'Múltiplas fontes por processo');
select throws_ok($$ select public.set_process_tracking('30000000-0000-0000-0000-000000000001','tjrs_x',true) $$,
  '23514', null, 'Fonte sem estratégia no tribunal não pode ser habilitada');

-- UPDATE direto de config por não-ADMIN é bloqueado
select tests_as('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$ update public.process_tracking_configs set frequency = interval '2 days'
  where process_id='30000000-0000-0000-0000-000000000001' and source_kind='datajud' $$,
  '42501', null, 'UPDATE direto da config por não-ADMIN é bloqueado (use as RPCs)');

-- =============================================================================
-- Elegibilidade (sweep)
-- =============================================================================
reset role;
-- P2 sem CNJ: datajud exige CNJ → não elegível; scraper não exige → elegível
select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select lives_ok($$ select public.set_process_tracking('30000000-0000-0000-0000-000000000002','datajud',true) $$,
  'ADMIN habilita datajud no processo SEM CNJ');
select lives_ok($$ select public.set_process_tracking('30000000-0000-0000-0000-000000000002','scraper',true) $$,
  'ADMIN habilita scraper no processo SEM CNJ');
-- processo arquivado
select lives_ok($$ select public.set_process_tracking('30000000-0000-0000-0000-0000000000f0','datajud',true) $$,
  'ADMIN habilita datajud no processo f0 (ativo)');

reset role;
update public.process_tracking_configs set next_run_at = now() - interval '1 minute';
-- Arquiva f0 depois de configurado
update public.processes set status = 'archived' where id = '30000000-0000-0000-0000-0000000000f0';

select ok(
  (select array['30000000-0000-0000-0000-000000000001'::uuid,'30000000-0000-0000-0000-000000000002'::uuid]
     <@ array(select c.process_id from public.process_tracking_configs c where c.id in (select app.tracking_due_config_ids()))),
  'P1 (com CNJ) e P2 (scraper) estão elegíveis');
select ok(
  not exists (select 1 from public.process_tracking_configs c
    where c.id in (select app.tracking_due_config_ids())
      and c.process_id = '30000000-0000-0000-0000-000000000002' and c.source_kind = 'datajud'),
  'P2 sem CNJ NÃO é elegível para datajud (fonte exige CNJ)');
select ok(
  not exists (select 1 from public.process_tracking_configs c
    where c.id in (select app.tracking_due_config_ids())
      and c.process_id = '30000000-0000-0000-0000-0000000000f0'),
  'Processo arquivado NÃO é elegível');
-- desarquiva f0 e reativa para não interferir; encerra e testa
update public.processes set status = 'closed' where id = '30000000-0000-0000-0000-0000000000f0';
select ok(
  not exists (select 1 from public.process_tracking_configs c
    where c.id in (select app.tracking_due_config_ids())
      and c.process_id = '30000000-0000-0000-0000-0000000000f0'),
  'Processo encerrado NÃO é elegível');

-- sweep enfileira runs pending
select lives_ok($$ select app.tracking_sweep() $$, 'tracking_sweep() executa');
select ok((select count(*) from public.collection_runs where status='pending' and trigger='scheduled') >= 2,
  'Sweep enfileirou coletas pendentes');
select ok(exists(select 1 from public.job_runs where job_name='tracking_sweep' and status='success'),
  'Sweep registrou job_runs');

-- =============================================================================
-- Coleta manual + lock
-- =============================================================================
delete from public.collection_runs;  -- limpa a fila do sweep p/ testar o manual isoladamente

select tests_as('00000000-0000-0000-0000-0000000000a2'); set local role authenticated;
select lives_ok($$ select public.collect_process_now('30000000-0000-0000-0000-000000000001','datajud') $$,
  'Responsável dispara coleta manual');
select is((select trigger::text from public.collection_runs
  where process_id='30000000-0000-0000-0000-000000000001' and source_kind='datajud'),
  'manual', 'Run manual criada');

select tests_as('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.collect_process_now('30000000-0000-0000-0000-000000000001','datajud') $$,
  '42501', null, 'Usuário de outro espaço não coleta');

select tests_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.collect_process_now('30000000-0000-0000-0000-000000000001','datajud') $$,
  '23505', null, 'Não enfileira segunda coleta com uma já pendente (lock de fila)');

-- claim + lock de execução
reset role; set local role service_role;
select ok((select public.claim_pending_collection_run() ->> 'run_id') is not null,
  'service_role reclama a coleta pendente (fica running)');
select is(public.claim_pending_collection_run(), null::jsonb,
  'Segundo claim não pega nada — só uma execução running por (processo, fonte)');
reset role;
select throws_ok($$
  insert into public.collection_runs (process_id, tracking_config_id, source_kind, trigger, status)
  select process_id, tracking_config_id, source_kind, 'manual', 'running'
  from public.collection_runs where status='running' limit 1 $$,
  '23505', null, 'Índice único impede duas execuções running para a mesma (processo, fonte)');

-- =============================================================================
-- submit_collection_result — 1ª sincronização
-- =============================================================================
do $$
declare v_run uuid;
begin
  select id into v_run from public.collection_runs where status='running'
    and process_id='30000000-0000-0000-0000-000000000001' and source_kind='datajud';
  set local role service_role;
  perform public.submit_collection_result(v_run, jsonb_build_object(
    'status','success','collected_at', now()::text, 'raw_payload', jsonb_build_object('pages',1),
    'state_hash','sh-1','first_sync_completed', true,
    'counts', jsonb_build_object('fetched',2,'new',2,'updated',0),
    'movements', jsonb_build_array(
      jsonb_build_object('content_hash','h-a','source_movement_id','S1','occurred_at','2024-03-01T00:00:00Z',
        'category_code','26','category_label','Distribuição','description','Distribuído','raw','{}'::jsonb,
        'needs_review',false,'is_first_sync',true,'revises_content_hash',null),
      jsonb_build_object('content_hash','h-b','source_movement_id','S2','occurred_at','2024-03-05T00:00:00Z',
        'category_code','132','category_label','Juntada','description','Juntada de petição','raw','{}'::jsonb,
        'needs_review',false,'is_first_sync',true,'revises_content_hash',null)
    ),
    'events', jsonb_build_array(
      jsonb_build_object('event_type','first_sync_completed','content_hash',null,'occurred_at',null,'payload','{}'::jsonb)
    )
  ));
  reset role;
end $$;

select is((select count(*)::int from public.process_movements where process_id='30000000-0000-0000-0000-000000000001'),
  2, '1ª sync: 2 movimentações persistidas');
select is((select count(*)::int from public.process_movements
  where process_id='30000000-0000-0000-0000-000000000001' and is_first_sync), 2,
  '1ª sync: todas com is_first_sync=true');
select is((select array_agg(event_type::text order by event_type) from public.process_change_events
  where process_id='30000000-0000-0000-0000-000000000001'), array['first_sync_completed'],
  '1ª sync: só first_sync_completed, nenhum new_movement');
select is((select first_sync_done from public.process_tracking_state
  where process_id='30000000-0000-0000-0000-000000000001' and source_kind='datajud'), true,
  'process_tracking_state.first_sync_done = true');
select is((select last_run_status::text from public.process_tracking_configs
  where process_id='30000000-0000-0000-0000-000000000001' and source_kind='datajud'), 'success',
  'config.last_run_status = success');

-- =============================================================================
-- 2ª coleta — nova movimentação + idempotência
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select lives_ok($$ select public.collect_process_now('30000000-0000-0000-0000-000000000001','datajud') $$,
  'Nova coleta manual');
reset role;
do $$
declare v_run uuid;
begin
  set local role service_role;
  select public.claim_pending_collection_run() ->> 'run_id' into v_run;
  perform public.submit_collection_result(v_run::uuid, jsonb_build_object(
    'status','success','collected_at', now()::text, 'raw_payload','{}'::jsonb,
    'state_hash','sh-2','first_sync_completed', false,
    'counts', jsonb_build_object('fetched',3,'new',1,'updated',0),
    'movements', jsonb_build_array(
      jsonb_build_object('content_hash','h-a','source_movement_id','S1','occurred_at','2024-03-01T00:00:00Z',
        'category_code','26','category_label','Distribuição','description','Distribuído','raw','{}'::jsonb,
        'needs_review',false,'is_first_sync',false,'revises_content_hash',null),
      jsonb_build_object('content_hash','h-b','source_movement_id','S2','occurred_at','2024-03-05T00:00:00Z',
        'category_code','132','category_label','Juntada','description','Juntada de petição','raw','{}'::jsonb,
        'needs_review',false,'is_first_sync',false,'revises_content_hash',null),
      jsonb_build_object('content_hash','h-c','source_movement_id','S3','occurred_at','2024-03-10T00:00:00Z',
        'category_code','848','category_label','Sentença','description','Sentença proferida','raw','{}'::jsonb,
        'needs_review',false,'is_first_sync',false,'revises_content_hash',null)
    ),
    'events', jsonb_build_array(
      jsonb_build_object('event_type','new_movement','content_hash','h-c','occurred_at','2024-03-10T00:00:00Z','payload','{}'::jsonb)
    )
  ));
  reset role;
end $$;
select is((select count(*)::int from public.process_movements where process_id='30000000-0000-0000-0000-000000000001'),
  3, 'Idempotência: h-a e h-b não duplicam; só h-c entra');
select is((select count(*)::int from public.process_change_events
  where process_id='30000000-0000-0000-0000-000000000001' and event_type='new_movement'), 1,
  'Um evento new_movement para a movimentação nova');

-- =============================================================================
-- Movimentação alterada — revision_of + movement_amended
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select lives_ok($$ select public.collect_process_now('30000000-0000-0000-0000-000000000001','datajud') $$, 'Coleta manual (amended)');
reset role;
do $$
declare v_run uuid;
begin
  set local role service_role;
  select public.claim_pending_collection_run() ->> 'run_id' into v_run;
  perform public.submit_collection_result(v_run::uuid, jsonb_build_object(
    'status','success','collected_at', now()::text, 'raw_payload','{}'::jsonb,
    'state_hash','sh-3','first_sync_completed', false,
    'counts', jsonb_build_object('fetched',1,'new',0,'updated',1),
    'movements', jsonb_build_array(
      jsonb_build_object('content_hash','h-c2','source_movement_id','S3','occurred_at','2024-03-10T00:00:00Z',
        'category_code','848','category_label','Sentença','description','Sentença proferida (retificada)','raw','{}'::jsonb,
        'needs_review',false,'is_first_sync',false,'revises_content_hash','h-c')
    ),
    'events', jsonb_build_array(
      jsonb_build_object('event_type','movement_amended','content_hash','h-c2','occurred_at','2024-03-10T00:00:00Z','payload','{}'::jsonb)
    )
  ));
  reset role;
end $$;
select is((select revision_of from public.process_movements where content_hash='h-c2'),
  (select id from public.process_movements where content_hash='h-c'),
  'Nova linha aponta revision_of para a movimentação original');
select ok(exists(select 1 from public.process_change_events
  where process_id='30000000-0000-0000-0000-000000000001' and event_type='movement_amended'),
  'Evento movement_amended registrado');

-- =============================================================================
-- Coleta parcial — não avança state_hash
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select lives_ok($$ select public.collect_process_now('30000000-0000-0000-0000-000000000001','datajud') $$, 'Coleta manual (parcial)');
reset role;
do $$
declare v_run uuid;
begin
  set local role service_role;
  select public.claim_pending_collection_run() ->> 'run_id' into v_run;
  perform public.submit_collection_result(v_run::uuid, jsonb_build_object(
    'status','partial','collected_at', now()::text, 'raw_payload','{}'::jsonb,
    'state_hash','sh-PARCIAL','first_sync_completed', false,
    'counts', jsonb_build_object('fetched',1,'new',0,'updated',0),
    'movements', jsonb_build_array(
      jsonb_build_object('content_hash','h-a','source_movement_id','S1','occurred_at','2024-03-01T00:00:00Z',
        'category_code','26','category_label','Distribuição','description','Distribuído','raw','{}'::jsonb,
        'needs_review',false,'is_first_sync',false,'revises_content_hash',null)),
    'events', '[]'::jsonb
  ));
  reset role;
end $$;
select is((select state_hash from public.process_tracking_state
  where process_id='30000000-0000-0000-0000-000000000001' and source_kind='datajud'), 'sh-3',
  'Coleta parcial NÃO avança o state_hash');
select is((select status::text from public.collection_runs where state_hash_after is null
  and process_id='30000000-0000-0000-0000-000000000001' order by created_at desc limit 1), 'partial',
  'Run parcial registrada como partial');

-- =============================================================================
-- Retry + auto-pausa (processo dedicado)
-- =============================================================================
insert into public.processes (id, space_id, court_id, assigned_user_id, created_by, cnj_number, status) values
 ('30000000-0000-0000-0000-0000000000fa','10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1','0000777-77.2024.8.04.0001','active');
select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select lives_ok($$ select public.set_process_tracking('30000000-0000-0000-0000-0000000000fa','datajud',true) $$, 'Habilita fa/datajud');
reset role;

do $$
declare i int; v_run uuid; v_cfg uuid;
begin
  select id into v_cfg from public.process_tracking_configs
    where process_id='30000000-0000-0000-0000-0000000000fa' and source_kind='datajud';
  for i in 1..5 loop
    -- enfileira (direto, simulando retry/sweep) e reclama
    insert into public.collection_runs (process_id, tracking_config_id, source_kind, trigger, status, attempt)
      values ('30000000-0000-0000-0000-0000000000fa', v_cfg, 'datajud', 'manual', 'pending', i);
    set local role service_role;
    select public.claim_pending_collection_run() ->> 'run_id' into v_run;
    perform public.submit_collection_failure(v_run::uuid,
      jsonb_build_object('error_code','timeout','error_message','sim','retriable', true));
    reset role;
    -- limpa retries pendentes gerados para não colidir com o próximo insert manual
    delete from public.collection_runs where process_id='30000000-0000-0000-0000-0000000000fa' and status='pending';
  end loop;
end $$;

select is((select consecutive_failures from public.process_tracking_configs
  where process_id='30000000-0000-0000-0000-0000000000fa' and source_kind='datajud'), 5,
  '5 falhas consecutivas contabilizadas');
select is((select enabled from public.process_tracking_configs
  where process_id='30000000-0000-0000-0000-0000000000fa' and source_kind='datajud'), false,
  'Config auto-pausada (enabled=false) após 5 falhas');
select ok((select paused_at from public.process_tracking_configs
  where process_id='30000000-0000-0000-0000-0000000000fa' and source_kind='datajud') is not null,
  'paused_at preenchido');
select is((select pause_reason from public.process_tracking_configs
  where process_id='30000000-0000-0000-0000-0000000000fa' and source_kind='datajud'), 'consecutive_failures',
  'pause_reason = consecutive_failures');
select ok(exists(select 1 from public.audit_logs where action='tracking.auto_paused'),
  'audit_logs registrou tracking.auto_paused');

-- retry: uma falha retriável (attempt 1) cria run de retry pendente
insert into public.processes (id, space_id, court_id, assigned_user_id, created_by, cnj_number, status) values
 ('30000000-0000-0000-0000-00000000f9f9','10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1','0000888-88.2024.8.04.0001','active');
select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select public.set_process_tracking('30000000-0000-0000-0000-00000000f9f9','datajud',true);
select public.collect_process_now('30000000-0000-0000-0000-00000000f9f9','datajud');
reset role;
do $$
declare v_run uuid;
begin
  set local role service_role;
  select public.claim_pending_collection_run() ->> 'run_id' into v_run;
  perform public.submit_collection_failure(v_run::uuid,
    jsonb_build_object('error_code','unavailable','error_message','sim','retriable', true));
  reset role;
end $$;
select ok(exists(select 1 from public.collection_runs
  where process_id='30000000-0000-0000-0000-00000000f9f9' and trigger='retry' and status='pending'
    and attempt=2 and queued_at > now()),
  'Falha retriável agenda um retry (attempt 2, no futuro)');

-- =============================================================================
-- RLS
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a3'); set local role authenticated;   -- colabA2: não é responsável de P1
select is((select count(*)::int from public.process_movements), 0,
  'COLABORADOR não-responsável não lê movimentações de P1');
select is((select count(*)::int from public.collection_runs), 0,
  'COLABORADOR não-responsável não lê collection_runs de P1');
select is((select count(*)::int from public.process_change_events), 0,
  'COLABORADOR não-responsável não lê process_change_events de P1');

select tests_as('00000000-0000-0000-0000-0000000000a1');   -- ADMIN A
select ok((select count(*) from public.process_movements
  where process_id='30000000-0000-0000-0000-000000000001') >= 3, 'ADMIN lê as movimentações do espaço');
select ok((select count(*) from public.process_responsible_history) >= 0, 'ADMIN ok');

select tests_as('00000000-0000-0000-0000-0000000000f1');   -- SUPER_ADMIN
select is((select count(*)::int from public.process_movements), 0, 'SUPER_ADMIN sem acesso a movimentações');
select is((select count(*)::int from public.collection_runs), 0, 'SUPER_ADMIN sem acesso a collection_runs');

select tests_as('00000000-0000-0000-0000-0000000000b1');   -- ADMIN B (cross-tenant)
select is((select count(*)::int from public.process_movements
  where space_id='10000000-0000-0000-0000-00000000000a'), 0, 'Cross-tenant: ADMIN B não lê nada do espaço A');

-- append-only
reset role;
select throws_ok($$ update public.process_movements set description='x'
  where process_id='30000000-0000-0000-0000-000000000001' $$, '23001', null,
  'process_movements é append-only (UPDATE bloqueado)');
select throws_ok($$ delete from public.process_movements
  where process_id='30000000-0000-0000-0000-000000000001' $$, '23001', null,
  'process_movements é append-only (DELETE bloqueado)');

-- =============================================================================
-- Auditoria
-- =============================================================================
select ok(exists(select 1 from public.audit_logs where action='tracking.enable'),
  'audit_logs registrou tracking.enable');
select ok(exists(select 1 from public.audit_logs where action='tracking.manual_collect'),
  'audit_logs registrou tracking.manual_collect');
select is((select count(*)::int from public.audit_logs where action in ('tracking.collect','collection.run','tracking.run')),
  0, 'Execução de rotina NÃO gera auditoria');

reset role;
select * from finish();
rollback;
