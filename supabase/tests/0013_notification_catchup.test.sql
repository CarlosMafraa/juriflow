-- =============================================================================
-- 0046 — processo nasce sem sincronização; fila de avisos pendentes
-- (notification_catchup_requests) alimentada pelas mudanças de configuração,
-- de destinatários e pela conexão do WhatsApp. Rode com: npm run db:test
-- =============================================================================
begin;
select * from no_plan();

create function tests_as(uid uuid) returns void
language sql security definer set search_path = '' as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
$$;

create function tests_queued(p uuid) returns boolean
language sql security definer set search_path = '' as $$
  select exists (select 1 from public.notification_catchup_requests where process_id = p);
$$;

create function tests_clear_queue() returns void
language sql security definer set search_path = '' as $$
  delete from public.notification_catchup_requests;
$$;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a1','authenticated','authenticated','adminA@t.test','x',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a2','authenticated','authenticated','colabA@t.test','x',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a3','authenticated','authenticated','colabB@t.test','x',now(),now(),now(),'{}','{}');

insert into public.spaces (id, name, slug) values ('10000000-0000-0000-0000-00000000000a','Escritorio A','escritorio-a');
update public.spaces set max_processes = 100, max_tracked_processes = 100;
insert into public.space_members (space_id, profile_id, role, status) values
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a1','ADMIN','active'),
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a2','COLABORADOR','active'),
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a3','COLABORADOR','active');
insert into public.courts (id, name, type, jurisdiction, active, tracking_source_kind) values
 ('20000000-0000-0000-0000-000000000001','TJ Teste','TJ','ZZ', true, 'projudi_tjam');

-- =============================================================================
-- Processo novo nasce sem sincronização
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select lives_ok($$ select public.create_process('10000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-000000000001','0000001-23.2024.8.04.0001', null,
  array['00000000-0000-0000-0000-0000000000a2']::uuid[]) $$, 'Cadastra P1');
select lives_ok($$ select public.create_process('10000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-000000000001','0000002-23.2024.8.04.0001', null,
  array['00000000-0000-0000-0000-0000000000a2']::uuid[]) $$, 'Cadastra P2');
select is((select count(*)::int from public.processes where tracking_enabled), 0,
  'Processo novo nasce com a sincronização desligada');
select lives_ok($$ update public.processes set tracking_enabled = true
  where cnj_number = '0000001-23.2024.8.04.0001' $$, 'ADMIN liga a sincronização só do P1');
reset role;

create temp table ids as
select (select id from public.processes where cnj_number = '0000001-23.2024.8.04.0001') as p1,
       (select id from public.processes where cnj_number = '0000002-23.2024.8.04.0001') as p2;
grant select on ids to authenticated;
select tests_clear_queue();

-- =============================================================================
-- Fila: só o worker enxerga
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select throws_ok($$ select * from public.notification_catchup_requests $$,
  '42501', null, 'Usuário não lê a fila de avisos pendentes');
select throws_ok($$ insert into public.notification_catchup_requests (process_id, space_id)
  select p1, '10000000-0000-0000-0000-00000000000a' from ids $$,
  '42501', null, 'Usuário não escreve na fila');

-- =============================================================================
-- Entrou responsável → histórico para ele (6-b)
-- =============================================================================
select lives_ok($$ select public.add_process_responsible((select p1 from ids),
  '00000000-0000-0000-0000-0000000000a3') $$, 'ADMIN inclui responsável no P1');
select lives_ok($$ select public.add_process_responsible((select p2 from ids),
  '00000000-0000-0000-0000-0000000000a3') $$, 'ADMIN inclui responsável no P2');
reset role;
select ok(tests_queued((select p1 from ids)), 'Responsável novo enfileira o P1');
select ok(not tests_queued((select p2 from ids)), 'P2 sem sincronização não entra na fila');
select tests_clear_queue();

-- =============================================================================
-- Configuração de notificação mudou (4-a)
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select lives_ok($$ insert into public.process_notification_configs (process_id, space_id, notify_clients)
  select p1, '10000000-0000-0000-0000-00000000000a', true from ids $$,
  'ADMIN personaliza as notificações do P1');
reset role;
select ok(tests_queued((select p1 from ids)), 'Config do processo enfileira o processo');
select tests_clear_queue();

select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select lives_ok($$ insert into public.space_notification_configs (space_id, notify_clients)
  values ('10000000-0000-0000-0000-00000000000a', true) $$, 'ADMIN salva o padrão do escritório');
reset role;
select ok(tests_queued((select p1 from ids)), 'Config do espaço enfileira os processos acompanhados');
select tests_clear_queue();

insert into public.space_movement_types (space_id, name)
values ('10000000-0000-0000-0000-00000000000a', 'TIPO TESTE')
on conflict do nothing;
select tests_clear_queue();
select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select lives_ok($$ update public.space_movement_types set notify_client = notify_client
  where space_id = '10000000-0000-0000-0000-00000000000a' $$, 'Salvar sem mudar nenhum toggle');
reset role;
select ok(not tests_queued((select p1 from ids)), 'Sem mudança real de toggle, nada entra na fila');
select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select lives_ok($$ update public.space_movement_types set notify_client = not notify_client
  where space_id = '10000000-0000-0000-0000-00000000000a' and name = 'TIPO TESTE' $$,
  'ADMIN troca o toggle de um tipo');
reset role;
select ok(tests_queued((select p1 from ids)), 'Toggle de tipo do escritório enfileira os processos');
select tests_clear_queue();

-- =============================================================================
-- Cliente vinculado / passou a aceitar avisos
-- =============================================================================
insert into public.clients (id, space_id, type, name, created_by) values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','PF','Cliente Um',
  '00000000-0000-0000-0000-0000000000a1');
select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select lives_ok($$ insert into public.process_clients (process_id, client_id, created_by)
  select p1, '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1' from ids $$,
  'ADMIN vincula cliente ao P1');
reset role;
select ok(tests_queued((select p1 from ids)), 'Cliente vinculado enfileira o processo');
select tests_clear_queue();

update public.clients set phone = '+5592900000002', notification_opt_in = true, opt_in_at = now()
 where id = '40000000-0000-0000-0000-000000000001';
select ok(tests_queued((select p1 from ids)), 'Cliente passou a aceitar avisos: enfileira os processos dele');
select tests_clear_queue();

-- =============================================================================
-- WhatsApp conectou (3)
-- =============================================================================
insert into public.whatsapp_sessions (space_id, session_name, status)
values ('10000000-0000-0000-0000-00000000000a', 'space_a', 'qr_ready');
select ok(not tests_queued((select p1 from ids)), 'Sessão ainda aguardando QR: nada na fila');
update public.whatsapp_sessions set status = 'connected' where space_id = '10000000-0000-0000-0000-00000000000a';
select ok(tests_queued((select p1 from ids)), 'WhatsApp conectou: processos acompanhados entram na fila');
select ok(not tests_queued((select p2 from ids)), 'Processo sem sincronização continua fora');
select tests_clear_queue();
update public.whatsapp_sessions set last_checked_at = now() where space_id = '10000000-0000-0000-0000-00000000000a';
select ok(not tests_queued((select p1 from ids)), 'Conferência da sessão já conectada não reenfileira');

-- O worker (service_role) lê e limpa a fila.
select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select lives_ok($$ select public.add_process_responsible((select p1 from ids),
  '00000000-0000-0000-0000-0000000000a1') $$, 'Enfileira de novo');
reset role;
set local role service_role;
select is((select count(*)::int from public.notification_catchup_requests), 1, 'Worker lê a fila');
select lives_ok($$ delete from public.notification_catchup_requests $$, 'Worker limpa a fila');
reset role;

select * from finish();
rollback;
