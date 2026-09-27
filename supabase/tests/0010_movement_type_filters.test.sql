-- =============================================================================
-- Filtro de notificação por tipo de movimentação (0042): lista padrão do
-- escritório (só ADMIN altera) e personalização por processo (ADMIN ou
-- responsável). Rode com: npm run db:test
-- =============================================================================
begin;
select * from no_plan();

create function tests_as(uid uuid) returns void
language sql security definer set search_path = '' as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
$$;

create function tests_rowcount(stmt text) returns int
language plpgsql as $$
declare n int;
begin execute stmt; get diagnostics n = row_count; return n; end;
$$;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a1','authenticated','authenticated','adminA@t.test','x',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a2','authenticated','authenticated','colabA1@t.test','x',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a3','authenticated','authenticated','colabA2@t.test','x',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000b1','authenticated','authenticated','adminB@t.test','x',now(),now(),now(),'{}','{}');

insert into public.spaces (id, name, slug) values
 ('10000000-0000-0000-0000-00000000000a','Escritorio A','escritorio-a'),
 ('10000000-0000-0000-0000-00000000000b','Escritorio B','escritorio-b');
update public.spaces set max_processes = 100, max_tracked_processes = 100;

insert into public.space_members (space_id, profile_id, role, status) values
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a1','ADMIN','active'),
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a2','COLABORADOR','active'),
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a3','COLABORADOR','active'),
 ('10000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000b1','ADMIN','active');

insert into public.courts (id, name, type, jurisdiction, active) values
 ('20000000-0000-0000-0000-000000000001','TJAM','TJ','AM', true);

-- P1: responsável colabA1
insert into public.processes (id, space_id, court_id, created_by, cnj_number)
values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a',
        '20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2',
        '0000001-23.2024.8.04.0001');
insert into public.process_responsible_history (process_id, responsible_id, assigned_by, reason) values
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a2','process_created');

-- ---- lista padrão ----
select ok((select count(*) from public.space_movement_types
           where space_id = '10000000-0000-0000-0000-00000000000a') >= 27,
  'Escritório novo já nasce com a lista de tipos do TJAM');
select ok(not exists (select 1 from public.space_movement_types where name like '% DE %ANDRADE%' or name like 'DECORRIDO PRAZO DE%'),
  'Lista padrão não tem nome de parte');
select ok((select bool_and(notify_responsible and notify_client) from public.space_movement_types),
  'Todos os tipos nascem avisando responsáveis e clientes');

-- Colaborador lê, mas não altera o padrão do escritório.
select tests_as('00000000-0000-0000-0000-0000000000a2'); set local role authenticated;
select ok((select count(*) from public.space_movement_types) >= 27, 'Colaborador vê a lista do escritório');
select is(tests_rowcount($$ update public.space_movement_types set notify_client = false
  where name = 'ALVARÁ ENVIADO' $$), 0, 'Colaborador não altera o padrão do escritório');
select throws_ok($$ insert into public.space_movement_types (space_id, name)
  values ('10000000-0000-0000-0000-00000000000a', 'TIPO INVENTADO') $$, '42501', null,
  'Ninguém do app inclui tipo na lista (vem da coleta)');
reset role;

-- ADMIN altera o padrão; fica na auditoria.
select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select is(tests_rowcount($$ update public.space_movement_types set notify_client = false
  where space_id = '10000000-0000-0000-0000-00000000000a' and name = 'DECISÃO INTERLOCUTÓRIA' $$), 1,
  'ADMIN altera o padrão do escritório');
reset role;
select ok(exists (select 1 from public.audit_logs where action = 'notification_config.movement_type.update'
  and entity_id = 'DECISÃO INTERLOCUTÓRIA' and actor_id = '00000000-0000-0000-0000-0000000000a1'),
  'Mudança do padrão fica na auditoria');

-- Outro escritório não vê nem altera.
select tests_as('00000000-0000-0000-0000-0000000000b1'); set local role authenticated;
select is((select count(*)::int from public.space_movement_types
           where space_id = '10000000-0000-0000-0000-00000000000a'), 0,
  'ADMIN de outro escritório não vê a lista deste');
select is(tests_rowcount($$ update public.space_movement_types set notify_client = false
  where space_id = '10000000-0000-0000-0000-00000000000a' $$), 0,
  'ADMIN de outro escritório não altera a lista deste');
reset role;

-- ---- personalização por processo ----
select tests_as('00000000-0000-0000-0000-0000000000a2'); set local role authenticated;
select lives_ok($$ insert into public.process_movement_type_prefs
  (process_id, space_id, name, notify_responsible, notify_client)
  values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000b',
          'EXPEDIÇÃO DE INTIMAÇÃO', true, false) $$,
  'Responsável (colaborador) personaliza o processo');
select is((select space_id from public.process_movement_type_prefs
           where process_id = '30000000-0000-0000-0000-000000000001'),
  '10000000-0000-0000-0000-00000000000a'::uuid, 'space_id vem do processo, não do que o cliente mandou');
reset role;

select tests_as('00000000-0000-0000-0000-0000000000a3'); set local role authenticated;
select is((select count(*)::int from public.process_movement_type_prefs), 0,
  'Colaborador que não é responsável não vê a personalização');
select throws_ok($$ insert into public.process_movement_type_prefs
  (process_id, space_id, name, notify_responsible, notify_client)
  values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a',
          'ALVARÁ ENVIADO', false, false) $$, '42501', null,
  'Colaborador que não é responsável não personaliza');
reset role;

select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select is(tests_rowcount($$ update public.process_movement_type_prefs set notify_client = true
  where process_id = '30000000-0000-0000-0000-000000000001' $$), 1, 'ADMIN altera a personalização do processo');
select throws_ok($$ insert into public.process_movement_type_prefs
  (process_id, space_id, name, notify_responsible, notify_client)
  values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a',
          'TIPO QUE NÃO EXISTE', true, true) $$, '23503', null,
  'Só personaliza tipo que existe na lista do escritório');
select is(tests_rowcount($$ delete from public.process_movement_type_prefs
  where process_id = '30000000-0000-0000-0000-000000000001' $$), 1, 'ADMIN volta o processo ao padrão');
reset role;

select is((select count(*)::int from public.audit_logs
           where action like 'notification_config.process_movement_type.%'
             and entity_id = '30000000-0000-0000-0000-000000000001'), 3,
  'Personalizar, alterar e voltar ao padrão ficam na auditoria');

-- Escritório criado depois também ganha a lista.
insert into public.spaces (id, name, slug) values ('10000000-0000-0000-0000-00000000000c','Escritorio C','escritorio-c');
select ok((select count(*) from public.space_movement_types
           where space_id = '10000000-0000-0000-0000-00000000000c') >= 27,
  'Todo escritório novo recebe a lista padrão');

select * from finish();
rollback;
