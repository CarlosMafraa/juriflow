-- =============================================================================
-- Suspensão de espaço, SUPER_ADMIN fora do conteúdo e limites do plano
-- (migrações 0035/0036). Rode com: npm run db:test
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
create function tests_system() returns void
language sql security definer set search_path = '' as $$
  select set_config('request.jwt.claims', '', true);
$$;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a1','authenticated','authenticated','adminA@t.test','x',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a2','authenticated','authenticated','colabA@t.test','x',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000f1','authenticated','authenticated','super@t.test','x',now(),now(),now(),'{}','{}');
update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-0000000000f1';

insert into public.spaces (id, name, slug, max_processes, max_tracked_processes) values
 ('10000000-0000-0000-0000-00000000000a','Escritorio A','escritorio-a', 3, 1);
insert into public.space_members (space_id, profile_id, role, status) values
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a1','ADMIN','active'),
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a2','COLABORADOR','active');
insert into public.courts (id, name, type, jurisdiction, active, tracking_source_kind) values
 ('20000000-0000-0000-0000-000000000001','TJ Teste','TJ','ZZ', true, 'projudi_tjam');
insert into public.message_templates (space_id, name, audience, body, created_by)
values ('10000000-0000-0000-0000-00000000000a','Tpl','client','Texto interno','00000000-0000-0000-0000-0000000000a1');
insert into public.whatsapp_sessions (space_id, session_name, status, qr_code)
values ('10000000-0000-0000-0000-00000000000a','space_x','qr_ready','data:image/png;base64,QR');

-- =============================================================================
-- PLANO — limite de processos e de sincronizados
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;

select lives_ok($$ select public.create_process('10000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-000000000001','0000001-23.2024.8.04.0001', null,
  array['00000000-0000-0000-0000-0000000000a2']::uuid[]) $$, '1º processo');
select lives_ok($$ select public.create_process('10000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-000000000001','0000002-23.2024.8.04.0001', null,
  array['00000000-0000-0000-0000-0000000000a2']::uuid[]) $$, '2º processo');

select is((select count(*)::int from public.processes where tracking_enabled), 1,
  'Só 1 processo entra com sincronização (limite do plano = 1); o 2º entra sem');
select is((select used_tracked from public.space_plan_usage('10000000-0000-0000-0000-00000000000a')), 1,
  'space_plan_usage informa 1 sincronizado');

select throws_ok($$ update public.processes set tracking_enabled = true
  where cnj_number = '0000002-23.2024.8.04.0001' $$,
  '23514', 'Limite de sincronização automática do plano atingido (1 processos).',
  'Ligar sincronização acima do limite é recusado com o motivo');

select lives_ok($$ select public.create_process('10000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-000000000001', null, 'REF-3',
  array['00000000-0000-0000-0000-0000000000a2']::uuid[]) $$, '3º processo');
select throws_ok($$ select public.create_process('10000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-000000000001', null, 'REF-4',
  array['00000000-0000-0000-0000-0000000000a2']::uuid[]) $$,
  '23514', 'Limite do plano atingido: este espaço permite até 3 processos.',
  '4º processo acima do limite é recusado');

-- Arquivado continua contando; excluído libera a vaga.
select lives_ok($$ update public.processes set status = 'archived' where internal_ref = 'REF-3' $$, 'Arquiva');
select throws_ok($$ select public.create_process('10000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-000000000001', null, 'REF-4',
  array['00000000-0000-0000-0000-0000000000a2']::uuid[]) $$,
  '23514', null, 'Processo arquivado continua ocupando vaga do plano');
select lives_ok($$ select public.soft_delete_process((select id from public.processes where internal_ref = 'REF-3')) $$,
  'Exclui o arquivado');
select lives_ok($$ select public.create_process('10000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-000000000001', null, 'REF-4',
  array['00000000-0000-0000-0000-0000000000a2']::uuid[]) $$, 'Excluído libera a vaga');

-- ADMIN não mexe no próprio plano nem no status.
select throws_ok($$ update public.spaces set max_processes = 999
  where id = '10000000-0000-0000-0000-00000000000a' $$,
  '42501', null, 'ADMIN não altera o limite do próprio plano');
select lives_ok($$ update public.spaces set name = 'Escritorio A Renomeado'
  where id = '10000000-0000-0000-0000-00000000000a' $$,
  'ADMIN continua alterando o nome do espaço');

-- =============================================================================
-- SUPER_ADMIN — sabe que o espaço existe, não vê nada de dentro
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000f1');
select is((select count(*)::int from public.spaces), 1, 'SUPER_ADMIN vê que o espaço existe');
select is((select count(*)::int from public.space_members), 0, 'SUPER_ADMIN não vê membros');
select is((select count(*)::int from public.processes), 0, 'SUPER_ADMIN não vê processos');
select is((select count(*)::int from public.audit_logs where space_id is not null), 0,
  'SUPER_ADMIN não vê a auditoria do espaço');
select is((select count(*)::int from public.message_templates), 0, 'SUPER_ADMIN não vê templates');
select is((select count(*)::int from public.whatsapp_sessions), 0, 'SUPER_ADMIN não vê o WhatsApp do espaço');
select throws_ok($$ select * from public.space_plan_usage('10000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'SUPER_ADMIN não vê o uso do plano (só os limites)');
select throws_ok($$ insert into public.space_members (space_id, profile_id, role, status)
  values ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000f1','ADMIN','active') $$,
  '42501', null, 'SUPER_ADMIN não se coloca dentro do espaço');

select lives_ok($$ update public.spaces set max_processes = 50, max_tracked_processes = 10
  where id = '10000000-0000-0000-0000-00000000000a' $$, 'SUPER_ADMIN define o plano');
select throws_ok($$ update public.spaces set name = 'Invasao'
  where id = '10000000-0000-0000-0000-00000000000a' $$,
  '42501', null, 'SUPER_ADMIN não altera os dados internos do espaço (nome)');

select lives_ok($$ update public.spaces set status = 'suspended'
  where id = '10000000-0000-0000-0000-00000000000a' $$, 'SUPER_ADMIN suspende o espaço');
select ok(exists(select 1 from public.audit_logs where action = 'space.suspend' and space_id is null),
  'Suspensão auditada como ação de plataforma, visível ao SUPER_ADMIN');
select ok(exists(select 1 from public.audit_logs where action = 'space.plan.update' and space_id is null),
  'Mudança de plano auditada como ação de plataforma');

-- =============================================================================
-- SUSPENSÃO — ninguém do espaço acessa nada; reativar devolve tudo
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.processes), 0, 'Espaço suspenso: ADMIN não vê processos');
select is((select count(*)::int from public.message_templates), 0, 'Espaço suspenso: ADMIN não vê templates');
select is((select status::text from public.spaces where id = '10000000-0000-0000-0000-00000000000a'),
  'suspended', 'Membro ainda enxerga o próprio espaço e sabe que está suspenso');
select ok(exists(select 1 from public.space_members where profile_id = '00000000-0000-0000-0000-0000000000a1'),
  'Membro ainda enxerga o próprio vínculo (para o app mostrar a tela de suspensão)');
select throws_ok($$ select public.create_process('10000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-000000000001', null, 'SUSP',
  array['00000000-0000-0000-0000-0000000000a2']::uuid[]) $$,
  '42501', null, 'Espaço suspenso: não cadastra processo');
select is(tests_rowcount($$ update public.spaces set status = 'active'
  where id = '10000000-0000-0000-0000-00000000000a' $$), 0,
  'ADMIN não reativa o próprio espaço (0 linhas)');

select tests_as('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.processes), 0, 'Espaço suspenso: colaborador não vê processos');

select tests_as('00000000-0000-0000-0000-0000000000f1');
select lives_ok($$ update public.spaces set status = 'active'
  where id = '10000000-0000-0000-0000-00000000000a' $$, 'SUPER_ADMIN reativa o espaço');

select tests_as('00000000-0000-0000-0000-0000000000a2');
select ok((select count(*)::int from public.processes) > 0, 'Reativado: colaborador volta a ver os processos dele');

-- =============================================================================
-- REGRESSÃO: usuário de fora do espaço não passa pelas RPCs de ADMIN
-- (is_space_admin devolvia NULL para não-membros — ver 0035, seção 0)
-- =============================================================================
reset role;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000c1','authenticated','authenticated','intruso@t.test','x',now(),now(),now(),'{}','{}');
select tests_as('00000000-0000-0000-0000-0000000000c1'); set local role authenticated;

select is(app.is_space_admin('10000000-0000-0000-0000-00000000000a'), false,
  'is_space_admin devolve false (não NULL) para quem não é membro');
select throws_ok($$ select public.create_space_invite('10000000-0000-0000-0000-00000000000a',
  'intruso@t.test', 'ADMIN') $$, '42501', null,
  'Intruso não se convida como ADMIN de outro espaço');
select throws_ok($$ select public.request_whatsapp_connect('10000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'Intruso não mexe no WhatsApp de outro espaço');
select throws_ok($$ select * from public.list_deleted_processes('10000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'Intruso não lista excluídos de outro espaço');
select throws_ok($$ select public.soft_delete_process((select id from public.processes limit 1)) $$,
  null, null, 'Intruso não exclui processo de outro espaço');
select is((select count(*)::int from public.space_members where profile_id = '00000000-0000-0000-0000-0000000000c1'), 0,
  'Intruso continua fora do espaço');

select * from finish();
rollback;
