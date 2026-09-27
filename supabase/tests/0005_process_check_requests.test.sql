-- =============================================================================
-- "Consultar agora" (0032): RPC request_process_check, intervalo mínimo,
-- colunas de acompanhamento protegidas e auditoria sem ruído do worker.
-- Rode com: npm run db:test
-- =============================================================================
begin;
select * from no_plan();

create function tests_as(uid uuid) returns void
language sql security definer set search_path = '' as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a1','authenticated','authenticated','adminA@t.test','x',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a2','authenticated','authenticated','colabA1@t.test','x',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000b1','authenticated','authenticated','adminB@t.test','x',now(),now(),now(),'{}','{}');

insert into public.spaces (id, name, slug) values
 ('10000000-0000-0000-0000-00000000000a','Escritorio A','escritorio-a'),
 ('10000000-0000-0000-0000-00000000000b','Escritorio B','escritorio-b');
insert into public.space_members (space_id, profile_id, role, status) values
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a1','ADMIN','active'),
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a2','COLABORADOR','active'),
 ('10000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000b1','ADMIN','active');

insert into public.courts (id, name, type, jurisdiction, active, tracking_source_kind) values
 ('20000000-0000-0000-0000-000000000001','TJ Teste','TJ','ZZ', true, 'projudi_tjam'),
 ('20000000-0000-0000-0000-000000000002','Sem coleta','TRT','ZZ', true, null);

update public.spaces set max_processes = 100, max_tracked_processes = 100;

insert into public.processes (id, space_id, court_id, created_by, cnj_number, internal_ref) values
 -- P1: rastreável
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','0000001-23.2024.8.04.0001', null),
 -- P2: sem CNJ
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2', null, 'REF-2'),
 -- P3: tribunal sem coleta
 ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2','0000003-23.2024.8.04.0001', null),
 -- P4: consultado agora há pouco
 ('30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','0000004-23.2024.8.04.0001', null);

-- Responsável de todos: colabA1
insert into public.process_responsible_history (process_id, responsible_id, assigned_by, reason)
select id, '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a2', 'process_created'
from public.processes;

update public.processes set last_checked_at = now() - interval '1 minute'
 where id = '30000000-0000-0000-0000-000000000004';

-- ---- Pedido legítimo ----
select tests_as('00000000-0000-0000-0000-0000000000a2'); set local role authenticated;

select lives_ok(
  $$ select public.request_process_check('30000000-0000-0000-0000-000000000001') $$,
  'Responsável pede consulta de processo rastreável');
select isnt(
  (select check_requested_at from public.processes where id = '30000000-0000-0000-0000-000000000001'),
  null, 'Pedido fica registrado em check_requested_at');
select lives_ok(
  $$ select public.request_process_check('30000000-0000-0000-0000-000000000001') $$,
  'Pedir de novo com pedido pendente é idempotente');

select throws_ok(
  $$ select public.request_process_check('30000000-0000-0000-0000-000000000002') $$,
  '23514', 'Informe o número CNJ para consultar o processo.',
  'Processo sem CNJ não pode ser consultado');
select throws_ok(
  $$ select public.request_process_check('30000000-0000-0000-0000-000000000003') $$,
  '23514', 'Este tribunal ainda não tem consulta automática.',
  'Tribunal sem fonte não pode ser consultado');
select throws_ok(
  $$ select public.request_process_check('30000000-0000-0000-0000-000000000004') $$,
  '23514', null,
  'Intervalo mínimo de 5 minutos entre consultas');

-- ---- Colunas do worker não são graváveis pela API ----
select throws_ok(
  $$ update public.processes set check_requested_at = null
     where id = '30000000-0000-0000-0000-000000000004' $$,
  '42501', null, 'Usuário não grava check_requested_at direto');
select throws_ok(
  $$ update public.processes set last_state_hash = 'forjado'
     where id = '30000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'Usuário não grava last_state_hash direto');
select throws_ok(
  $$ insert into public.processes (space_id, court_id, created_by, cnj_number, last_state_hash)
     values ('10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001',
             '00000000-0000-0000-0000-0000000000a2','0000009-23.2024.8.04.0001','forjado') $$,
  '42501', null, 'Usuário não cria processo com last_state_hash forjado');
select lives_ok(
  $$ select public.create_process('10000000-0000-0000-0000-00000000000a',
       '20000000-0000-0000-0000-000000000001', '0000009-23.2024.8.04.0001', null) $$,
  'Cadastro normal de processo continua funcionando');
select lives_ok(
  $$ update public.processes set internal_ref = 'ok-editavel'
     where id = '30000000-0000-0000-0000-000000000001' $$,
  'Colunas de negócio continuam editáveis');
reset role;

-- ---- Outro espaço não pede consulta ----
select tests_as('00000000-0000-0000-0000-0000000000b1'); set local role authenticated;
select throws_ok(
  $$ select public.request_process_check('30000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'ADMIN de outro espaço não pede consulta');
reset role;

-- ---- Auditoria ----
select is(
  (select count(*)::int from public.audit_logs
    where action = 'process.check.request' and entity_id = '30000000-0000-0000-0000-000000000001'),
  1, 'Pedido de consulta auditado uma única vez (idempotente)');

select set_config('request.jwt.claims', '', true);
update public.processes
   set last_checked_at = now(), last_state_hash = 'h', check_requested_at = null
 where id = '30000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.audit_logs
    where action = 'process.update' and entity_id = '30000000-0000-0000-0000-000000000001'
      and actor_type = 'system'),
  0, 'Atualização só de colunas de acompanhamento (worker) não gera process.update');

select * from finish();
rollback;
