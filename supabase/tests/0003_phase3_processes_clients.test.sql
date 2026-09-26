-- =============================================================================
-- Fase 3 — RLS e regras de negócio: processos, clientes, vínculos, transferência,
-- histórico, tribunais, soft delete, CNJ/documento, PF/PJ, SUPER_ADMIN.
-- Rode com: npm run db:test
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

-- ---- usuários ----
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a1','authenticated','authenticated','adminA@t.test','x',now(),now(),now(),'{}','{"full_name":"Admin A"}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a2','authenticated','authenticated','colabA1@t.test','x',now(),now(),now(),'{}','{"full_name":"Colab A1"}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a3','authenticated','authenticated','colabA2@t.test','x',now(),now(),now(),'{}','{"full_name":"Colab A2"}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000b1','authenticated','authenticated','adminB@t.test','x',now(),now(),now(),'{}','{"full_name":"Admin B"}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000b2','authenticated','authenticated','colabB1@t.test','x',now(),now(),now(),'{}','{"full_name":"Colab B1"}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000f1','authenticated','authenticated','super@t.test','x',now(),now(),now(),'{}','{"full_name":"Super"}');

update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-0000000000f1';

-- ---- espaços e membros ----
insert into public.spaces (id, name, slug) values
 ('10000000-0000-0000-0000-00000000000a','Escritorio A','escritorio-a'),
 ('10000000-0000-0000-0000-00000000000b','Escritorio B','escritorio-b');

insert into public.space_members (space_id, profile_id, role, status) values
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a1','ADMIN','active'),
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a2','COLABORADOR','active'),
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a3','COLABORADOR','active'),
 ('10000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000b1','ADMIN','active'),
 ('10000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000b2','COLABORADOR','active');

-- ---- tribunais ----
insert into public.courts (id, name, type, jurisdiction, active) values
 ('20000000-0000-0000-0000-000000000001','TJAM','TJ','AM', true),
 ('20000000-0000-0000-0000-000000000002','Vara Extinta','TJ','AM', false);


-- Limites altos: este arquivo testa regras de processo, não o plano (ver 0006).
update public.spaces set max_processes = 100, max_tracked_processes = 100;

-- ---- processos (inseridos como postgres; responsáveis = períodos abertos) ----
-- P1: criado por colabA1, responsável colabA1
insert into public.processes (id, space_id, court_id, created_by, cnj_number)
values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a',
        '20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2',
        '0000001-23.2024.8.04.0001');
-- P2: criado por adminA, responsável colabA2
insert into public.processes (id, space_id, court_id, created_by, internal_ref)
values ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000a',
        '20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','REF-P2');
-- P-B1: espaço B
insert into public.processes (id, space_id, court_id, created_by)
values ('30000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000b',
        '20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1');

insert into public.process_responsible_history (process_id, responsible_id, assigned_by, reason) values
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a2','process_created'),
 ('30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a1','process_created'),
 ('30000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000b1','process_created');

-- ---- clientes ----
insert into public.clients (id, space_id, type, name, document, created_by) values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','PF','Joao','52998224725','00000000-0000-0000-0000-0000000000a2'),
 ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000a','PF','Pedro','39053344705','00000000-0000-0000-0000-0000000000a1'),
 ('40000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000b','PF','Maria B','11144477735','00000000-0000-0000-0000-0000000000b1');

-- =============================================================================
-- LEITURA de processos — colaborador só vê onde é responsável
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a2'); set local role authenticated;
select is((select count(*)::int from public.processes), 1,
  'COLABORADOR A1 vê só o processo onde é responsável (P1)');
select ok(not exists(select 1 from public.processes where id = '30000000-0000-0000-0000-000000000002'),
  'COLABORADOR A1 NÃO vê P2 (responsável é o A2)');

select tests_as('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.processes), 2,
  'ADMIN A vê todos os processos do espaço A, mesmo sem ser responsável de nenhum');

select tests_as('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.processes where space_id = '10000000-0000-0000-0000-00000000000a'), 0,
  'Cross-tenant: ADMIN B não vê processos do espaço A');

select tests_as('00000000-0000-0000-0000-0000000000f1');
select is((select count(*)::int from public.processes), 0,
  'SUPER_ADMIN não tem acesso a processes');

-- =============================================================================
-- CADASTRO — só pela RPC create_process
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$
  insert into public.processes (space_id, court_id, created_by)
  values ('10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000a2')
$$, '42501', null, 'INSERT direto em processes é bloqueado (só via create_process)');

select throws_ok($$ select public.create_process(
  '10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001', null, 'X',
  array['00000000-0000-0000-0000-0000000000a3']::uuid[]) $$,
  '42501', null, 'COLABORADOR não define outro responsável');

select lives_ok($$ select public.create_process(
  '10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001', null, 'REF-A1-SELF') $$,
  'COLABORADOR cadastra processo');
select ok(exists(
  select 1 from public.processes p
  join public.process_responsible_history h on h.process_id = p.id and h.ended_at is null
  where p.internal_ref = 'REF-A1-SELF' and h.responsible_id = '00000000-0000-0000-0000-0000000000a2'),
  'Quem cadastra como COLABORADOR vira o responsável e já enxerga o processo');

select tests_as('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.create_process(
  '10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001', null, 'REF-MULTI',
  array['00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a3']::uuid[]) $$,
  'ADMIN cadastra processo com 2 responsáveis');
select is((select count(*)::int from public.process_responsible_history h
           join public.processes p on p.id = h.process_id
           where p.internal_ref = 'REF-MULTI' and h.ended_at is null), 2,
  'Processo tem 2 responsáveis em aberto');

select throws_ok($$ select public.create_process(
  '10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001', null, 'SEM-RESP', null) $$,
  '23514', 'Informe ao menos um responsável.', 'ADMIN precisa informar ao menos um responsável');
select throws_ok($$ select public.create_process(
  '10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000002', null, 'TRIB-INATIVO',
  array['00000000-0000-0000-0000-0000000000a3']::uuid[]) $$,
  '23514', null, 'Processo com tribunal INATIVO é rejeitado (Q6)');
select throws_ok($$ select public.create_process(
  '10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001', null, 'RESP-B',
  array['00000000-0000-0000-0000-0000000000b2']::uuid[]) $$,
  '23514', null, 'Responsável precisa ser membro ativo do espaço (rejeita membro do espaço B)');
select throws_ok($$ select public.create_process(
  '10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001',
  '0000001-23.2024.8.04.0001', null, array['00000000-0000-0000-0000-0000000000a3']::uuid[]) $$,
  '23505', null, 'CNJ duplicado no mesmo espaço é rejeitado');

select tests_as('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.create_process(
  '10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001', null, 'INVASAO') $$,
  '42501', null, 'Membro de outro espaço não cadastra processo no espaço A');

-- =============================================================================
-- EDIÇÃO — qualquer responsável edita, vincula e arquiva; o resto é do ADMIN
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a3');
select is(tests_rowcount($$
  update public.processes set internal_ref = 'editado-pelo-responsavel'
  where id = '30000000-0000-0000-0000-000000000002' $$), 1,
  'Responsável edita o processo mesmo sem ser quem cadastrou');

select tests_as('00000000-0000-0000-0000-0000000000a2');
select is(tests_rowcount($$
  update public.processes set internal_ref = 'hack'
  where id = '30000000-0000-0000-0000-000000000002' $$), 0,
  'Quem não é responsável não edita (0 linhas)');
select throws_ok($$
  update public.processes set status = 'closed'
  where id = '30000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'COLABORADOR não encerra processo (é do ADMIN)');
select is(tests_rowcount($$
  update public.processes set status = 'archived'
  where id = '30000000-0000-0000-0000-000000000001' $$), 1,
  'COLABORADOR responsável arquiva o processo');
select throws_ok($$
  update public.processes set status = 'active'
  where id = '30000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'COLABORADOR não reativa processo arquivado (é do ADMIN)');
select throws_ok($$ select public.soft_delete_process('30000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'COLABORADOR não exclui processo, nem arquivado');

select tests_as('00000000-0000-0000-0000-0000000000a1');
select is(tests_rowcount($$
  update public.processes set status = 'active'
  where id = '30000000-0000-0000-0000-000000000001' $$), 1,
  'ADMIN reativa o processo arquivado');

-- =============================================================================
-- RESPONSÁVEIS — só o ADMIN acrescenta/remove; nunca fica sem responsável
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.add_process_responsible(
  '30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a3') $$,
  '42501', null, 'COLABORADOR não acrescenta responsável');

select tests_as('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.add_process_responsible(
  '30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a3') $$,
  'ADMIN acrescenta colabA2 como corresponsável de P1');
select throws_ok($$ select public.add_process_responsible(
  '30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a3') $$,
  '23514', null, 'Não duplica responsável');

select tests_as('00000000-0000-0000-0000-0000000000a3');
select ok(exists(select 1 from public.processes where id = '30000000-0000-0000-0000-000000000001'),
  'Corresponsável passa a ver o processo');
select is((select count(*)::int from public.process_responsible_history
           where process_id = '30000000-0000-0000-0000-000000000001' and ended_at is null), 2,
  'Colaborador vê quem são os corresponsáveis do próprio processo');

select tests_as('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.remove_process_responsible(
  '30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2') $$,
  'ADMIN remove colabA1 de P1');
select throws_ok($$ select public.remove_process_responsible(
  '30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a3') $$,
  '23514', 'O processo precisa ter ao menos um responsável.', 'Não remove o último responsável');
select is((select count(*)::int from public.process_responsible_history
           where process_id = '30000000-0000-0000-0000-000000000001'), 2,
  'Histórico preservado (período encerrado continua registrado)');

select tests_as('00000000-0000-0000-0000-0000000000a2');
select ok(not exists(select 1 from public.processes where id = '30000000-0000-0000-0000-000000000001'),
  'Ex-responsável perde acesso ao processo, mesmo tendo cadastrado');
select is(tests_rowcount($$
  update public.processes set internal_ref = 'x' where id = '30000000-0000-0000-0000-000000000001' $$),
  0, 'Ex-responsável não edita');

select tests_as('00000000-0000-0000-0000-0000000000f1');
select is((select count(*)::int from public.process_responsible_history), 0,
  'SUPER_ADMIN não lê process_responsible_history');

-- =============================================================================
-- CLIENTES — compartilhados no espaço
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.clients), 2,
  'COLABORADOR vê todos os clientes do próprio espaço (compartilhados)');
select ok(not exists(select 1 from public.clients where id = '40000000-0000-0000-0000-0000000000b1'),
  'COLABORADOR não vê clientes de outro espaço');
select tests_as('00000000-0000-0000-0000-0000000000f1');
select is((select count(*)::int from public.clients), 0,
  'SUPER_ADMIN não tem acesso a clients');

select tests_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$
  insert into public.clients (space_id, type, name, document, created_by)
  values ('10000000-0000-0000-0000-00000000000a','PF','Joao Xerox','529.982.247-25','00000000-0000-0000-0000-0000000000a1')
$$, '23505', null, 'CPF duplicado no mesmo espaço é rejeitado (normalização ignora máscara)');
select lives_ok($$
  insert into public.clients (space_id, type, name, document, created_by)
  values ('10000000-0000-0000-0000-00000000000a','PJ','Empresa','11.222.333/0001-81','00000000-0000-0000-0000-0000000000a1')
$$, 'CNPJ válido é aceito');
select tests_as('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$
  insert into public.clients (space_id, type, name, document, created_by)
  values ('10000000-0000-0000-0000-00000000000b','PF','Joao no espaco B','52998224725','00000000-0000-0000-0000-0000000000b1')
$$, 'Mesmo CPF em outro espaço é permitido (isolamento)');

select tests_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$
  insert into public.clients (space_id, type, name, birth_date, created_by)
  values ('10000000-0000-0000-0000-00000000000a','PJ','PJ com nascimento','1990-01-01','00000000-0000-0000-0000-0000000000a1')
$$, '23514', null, 'PJ com birth_date é rejeitado');

-- =============================================================================
-- process_clients — vínculo
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$
  insert into public.process_clients (process_id, client_id, created_by)
  values ('30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1')
$$, 'ADMIN vincula cliente do mesmo espaço ao processo');
select throws_ok($$
  insert into public.process_clients (process_id, client_id, created_by)
  values ('30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1')
$$, '23514', null, 'Vínculo cross-tenant (cliente do espaço B) é rejeitado');
select throws_ok($$
  insert into public.process_clients (process_id, client_id, created_by)
  values ('30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1')
$$, '23505', null, 'Mesmo processo + mesmo cliente não gera 2 vínculos ativos');

select tests_as('00000000-0000-0000-0000-0000000000a3');
select lives_ok($$
  insert into public.process_clients (process_id, client_id, created_by)
  values ('30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a3')
$$, 'Responsável vincula cliente ao próprio processo');
select tests_as('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$
  insert into public.process_clients (process_id, client_id, created_by)
  values ('30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2')
$$, '42501', null, 'Quem não é responsável não vincula clientes');

-- =============================================================================
-- EXCLUSÃO — só ADMIN, só arquivado, reversível
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.soft_delete_client('40000000-0000-0000-0000-000000000001') $$,
  'ADMIN exclui (anonimiza) um cliente');
select ok(not exists(select 1 from public.clients where id = '40000000-0000-0000-0000-000000000001'),
  'Cliente excluído não aparece nas consultas normais');

select throws_ok($$ select public.soft_delete_process('30000000-0000-0000-0000-000000000002') $$,
  '23514', 'Arquive o processo antes de excluí-lo.', 'Processo ativo não pode ser excluído direto');
select is(tests_rowcount($$
  update public.processes set status = 'archived' where id = '30000000-0000-0000-0000-000000000002' $$), 1,
  'ADMIN arquiva P2');
select throws_ok($$
  update public.processes set deleted_at = now() where id = '30000000-0000-0000-0000-000000000002' $$,
  '42501', null, 'UPDATE direto de deleted_at é bloqueado (sem grant de coluna)');
select lives_ok($$ select public.soft_delete_process('30000000-0000-0000-0000-000000000002') $$,
  'ADMIN exclui P2 a partir dos arquivados');
select ok(not exists(select 1 from public.processes where id = '30000000-0000-0000-0000-000000000002'),
  'Processo excluído some das consultas normais');
select is((select count(*)::int from public.list_deleted_processes('10000000-0000-0000-0000-00000000000a')), 1,
  'Processo excluído aparece na lista de excluídos do ADMIN');

select tests_as('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$ select * from public.list_deleted_processes('10000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'COLABORADOR não vê a lista de excluídos');
select throws_ok($$ select public.restore_process('30000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'COLABORADOR não restaura processo');

select tests_as('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.restore_process('30000000-0000-0000-0000-000000000002') $$,
  'ADMIN restaura o processo excluído');
select is((select status::text from public.processes where id = '30000000-0000-0000-0000-000000000002'),
  'archived', 'Processo restaurado volta para os arquivados');

-- =============================================================================
-- AUDITORIA — verbos gravados
-- =============================================================================
reset role;
select ok(exists(select 1 from public.audit_logs where action = 'process.responsible.add'),
  'audit_logs registrou process.responsible.add');
select ok(exists(select 1 from public.audit_logs where action = 'process.responsible.remove'
  and entity_id = '30000000-0000-0000-0000-000000000001'),
  'audit_logs registrou process.responsible.remove');
select ok(exists(select 1 from public.audit_logs where action = 'process.archive'),
  'audit_logs registrou process.archive');
select ok(exists(select 1 from public.audit_logs where action = 'process.soft_delete'
  and entity_id = '30000000-0000-0000-0000-000000000002'),
  'audit_logs registrou process.soft_delete');
select ok(exists(select 1 from public.audit_logs where action = 'process.restore'
  and entity_id = '30000000-0000-0000-0000-000000000002'),
  'audit_logs registrou process.restore');
select ok(exists(select 1 from public.audit_logs where action = 'client.soft_delete'
  and entity_id = '40000000-0000-0000-0000-000000000001'),
  'audit_logs registrou client.soft_delete');
select ok(exists(select 1 from public.audit_logs where action = 'court.create' and space_id is null),
  'audit_logs de court é ação de plataforma (space_id null)');

select * from finish();
rollback;
