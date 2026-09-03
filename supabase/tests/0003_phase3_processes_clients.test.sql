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

-- ---- processos (inseridos como postgres; simulando os fluxos) ----
-- P1: criado por colabA1, responsável colabA1
insert into public.processes (id, space_id, court_id, assigned_user_id, created_by, cnj_number)
values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a',
        '20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2',
        '00000000-0000-0000-0000-0000000000a2','0000001-23.2024.8.04.0001');
-- P2: criado por adminA, responsável colabA2
insert into public.processes (id, space_id, court_id, assigned_user_id, created_by, internal_ref)
values ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000a',
        '20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a3',
        '00000000-0000-0000-0000-0000000000a1','REF-P2');
-- P-B1: espaço B
insert into public.processes (id, space_id, court_id, assigned_user_id, created_by)
values ('30000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000b',
        '20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b2',
        '00000000-0000-0000-0000-0000000000b1');

-- ---- clientes ----
insert into public.clients (id, space_id, type, name, document, created_by) values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','PF','Joao','52998224725','00000000-0000-0000-0000-0000000000a2'),
 ('40000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000b','PF','Maria B','11144477735','00000000-0000-0000-0000-0000000000b1');

-- =============================================================================
-- Gatilho abriu o 1º período de responsabilidade
-- =============================================================================
select is(
  (select count(*)::int from public.process_responsible_history
   where process_id = '30000000-0000-0000-0000-000000000001' and ended_at is null),
  1, 'Cadastro do processo abre 1 período de responsabilidade em aberto');

-- =============================================================================
-- LEITURA de processos
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a2'); set local role authenticated;
select is((select count(*)::int from public.processes), 1,
  'COLABORADOR A1 vê só o processo onde é responsável atual (P1)');
select ok(exists(select 1 from public.processes where id = '30000000-0000-0000-0000-000000000001'),
  'COLABORADOR A1 vê P1');
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
  'SUPER_ADMIN não tem acesso operacional a processes (RN7)');

-- =============================================================================
-- CRIAÇÃO de processo
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$
  insert into public.processes (space_id, court_id, assigned_user_id, created_by)
  values ('10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a2')
$$, '42501', null, 'COLABORADOR não cria processo atribuído a outra pessoa');

select lives_ok($$
  insert into public.processes (space_id, court_id, assigned_user_id, created_by, internal_ref)
  values ('10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a2','REF-A1-SELF')
$$, 'COLABORADOR cria processo para si mesmo');

select tests_as('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$
  insert into public.processes (space_id, court_id, assigned_user_id, created_by, internal_ref)
  values ('10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a1','REF-ADMIN-ASSIGN')
$$, 'ADMIN cria processo atribuído a outro usuário do espaço');

select throws_ok($$
  insert into public.processes (space_id, court_id, assigned_user_id, created_by)
  values ('10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000002',
          '00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a1')
$$, '23514', null, 'Processo com tribunal INATIVO é rejeitado (Q6)');

select throws_ok($$
  insert into public.processes (space_id, court_id, assigned_user_id, created_by)
  values ('10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a1')
$$, '23514', null, 'Responsável precisa ser membro ativo do espaço (rejeita membro do espaço B)');

-- CNJ
select lives_ok($$
  insert into public.processes (id, space_id, court_id, assigned_user_id, created_by)
  values ('30000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-00000000000a',
          '20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a3',
          '00000000-0000-0000-0000-0000000000a1')
$$, 'Processo SEM CNJ é permitido');
select throws_ok($$
  insert into public.processes (space_id, court_id, assigned_user_id, created_by, cnj_number)
  values ('10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a1',
          '0000001-23.2024.8.04.0001')
$$, '23505', null, 'CNJ duplicado no mesmo espaço é rejeitado');

-- =============================================================================
-- EDIÇÃO de processo (rev. 3: criador OU ADMIN; responsável-não-criador = read-only)
-- =============================================================================
-- colabA1 é criador E responsável de P1 -> pode editar internal_ref
select tests_as('00000000-0000-0000-0000-0000000000a2');
select is(tests_rowcount($$
  update public.processes set internal_ref = 'editado-pelo-criador'
  where id = '30000000-0000-0000-0000-000000000001' $$), 1,
  'Criador que é o responsável atual edita o próprio processo');

-- colabA2 é responsável de P2 mas NÃO é o criador -> não edita
select tests_as('00000000-0000-0000-0000-0000000000a3');
select is(tests_rowcount($$
  update public.processes set internal_ref = 'hack'
  where id = '30000000-0000-0000-0000-000000000002' $$), 0,
  'Responsável atual que NÃO é o criador não edita (0 linhas)');

-- colabA1 não pode trocar o responsável direto
select tests_as('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$
  update public.processes set assigned_user_id = '00000000-0000-0000-0000-0000000000a3'
  where id = '30000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'Criador/COLABORADOR não troca assigned_user_id direto (é do ADMIN)');
select throws_ok($$
  update public.processes set status = 'closed'
  where id = '30000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'Criador/COLABORADOR não encerra processo (é do ADMIN)');
select is(tests_rowcount($$
  update public.processes set status = 'archived'
  where id = '30000000-0000-0000-0000-000000000001' $$), 1,
  'Criador arquiva o próprio processo (active -> archived)');
select is(tests_rowcount($$
  update public.processes set status = 'active'
  where id = '30000000-0000-0000-0000-000000000001' $$), 1,
  'Criador reativa o próprio processo (archived -> active)');

-- ADMIN edita qualquer processo do espaço
select tests_as('00000000-0000-0000-0000-0000000000a1');
select is(tests_rowcount($$
  update public.processes set internal_ref = 'admin-editou'
  where id = '30000000-0000-0000-0000-000000000001' $$), 1,
  'ADMIN edita qualquer processo do espaço');

-- =============================================================================
-- TRANSFERÊNCIA (RPC) — atômica; histórico; ex-responsável perde acesso
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.transfer_process(
  '30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a3') $$,
  '42501', null, 'COLABORADOR não pode chamar transfer_process');

select tests_as('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.transfer_process(
  '30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a3') $$,
  'ADMIN transfere P1 de colabA1 para colabA2');

select is(
  (select assigned_user_id from public.processes where id = '30000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-0000000000a3'::uuid,
  'assigned_user_id foi atualizado');
select is(
  (select count(*)::int from public.process_responsible_history
   where process_id = '30000000-0000-0000-0000-000000000001'),
  2, 'Histórico preservado: 2 períodos (cadastro + transferência)');
select is(
  (select count(*)::int from public.process_responsible_history
   where process_id = '30000000-0000-0000-0000-000000000001' and ended_at is null),
  1, 'Exatamente 1 período em aberto após a transferência');
select is(
  (select responsible_id from public.process_responsible_history
   where process_id = '30000000-0000-0000-0000-000000000001' and ended_at is null),
  '00000000-0000-0000-0000-0000000000a3'::uuid,
  'Período aberto reflete o novo responsável');

-- ex-responsável (colabA1) perde o acesso a P1 imediatamente
select tests_as('00000000-0000-0000-0000-0000000000a2');
select ok(not exists(select 1 from public.processes where id = '30000000-0000-0000-0000-000000000001'),
  'Ex-responsável perde acesso ao processo após a transferência');
-- e mesmo sendo o CRIADOR original, não consegue editar (Q7)
select is(tests_rowcount($$
  update public.processes set internal_ref = 'x' where id = '30000000-0000-0000-0000-000000000001' $$),
  0, 'Criador transferido para fora NÃO edita (Q7 = SIM)');

-- =============================================================================
-- HISTÓRICO — só ADMIN lê
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a1');
select ok((select count(*) from public.process_responsible_history
           where process_id = '30000000-0000-0000-0000-000000000001') >= 2,
  'ADMIN lê o histórico de responsabilidade');
select tests_as('00000000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.process_responsible_history), 0,
  'COLABORADOR (mesmo responsável atual) não lê process_responsible_history');
select tests_as('00000000-0000-0000-0000-0000000000f1');
select is((select count(*)::int from public.process_responsible_history), 0,
  'SUPER_ADMIN não lê process_responsible_history');

-- =============================================================================
-- CLIENTES — RLS
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.clients), 1,
  'COLABORADOR vê os clientes do próprio espaço');
select ok(not exists(select 1 from public.clients where id = '40000000-0000-0000-0000-0000000000b1'),
  'COLABORADOR não vê clientes de outro espaço');
select tests_as('00000000-0000-0000-0000-0000000000f1');
select is((select count(*)::int from public.clients), 0,
  'SUPER_ADMIN não tem acesso operacional a clients');

-- Documento único por espaço; mesmo doc em espaços diferentes é permitido
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

-- PF/PJ + birth_date
select tests_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$
  insert into public.clients (space_id, type, name, birth_date, created_by)
  values ('10000000-0000-0000-0000-00000000000a','PJ','PJ com nascimento','1990-01-01','00000000-0000-0000-0000-0000000000a1')
$$, '23514', null, 'PJ com birth_date é rejeitado');
select lives_ok($$
  insert into public.clients (space_id, type, name, birth_date, created_by)
  values ('10000000-0000-0000-0000-00000000000a','PF','PF com nascimento','1990-01-01','00000000-0000-0000-0000-0000000000a1')
$$, 'PF com birth_date funciona');

-- =============================================================================
-- process_clients — cross-tenant e vínculo
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

-- responsável-não-criador não gerencia vínculos
select tests_as('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$
  insert into public.process_clients (process_id, client_id, created_by)
  values ('30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a3')
$$, '42501', null, 'Responsável que não é o criador não vincula clientes');

-- =============================================================================
-- SOFT DELETE
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.soft_delete_client('40000000-0000-0000-0000-000000000001') $$,
  'ADMIN exclui (anonimiza) um cliente');
select ok(not exists(select 1 from public.clients where id = '40000000-0000-0000-0000-000000000001'),
  'Cliente excluído não aparece nas consultas normais');
select tests_as('00000000-0000-0000-0000-0000000000f1');
reset role;
select is((select name from public.clients where id = '40000000-0000-0000-0000-000000000001'),
  'Cliente removido', 'PII do cliente foi anonimizado');
select is((select document from public.clients where id = '40000000-0000-0000-0000-000000000001'),
  null::extensions.citext, 'Documento do cliente foi apagado na anonimização');

select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select lives_ok($$ select public.soft_delete_process('30000000-0000-0000-0000-000000000002') $$,
  'ADMIN faz soft delete de um processo');
select ok(not exists(select 1 from public.processes where id = '30000000-0000-0000-0000-000000000002'),
  'Processo com soft delete não aparece nas consultas normais');

-- =============================================================================
-- AUDITORIA — verbos gravados
-- =============================================================================
reset role;
select ok(exists(select 1 from public.audit_logs where action = 'process.create'
  and entity_id = '30000000-0000-0000-0000-000000000009'),
  'audit_logs registrou process.create');
select ok(exists(select 1 from public.audit_logs where action = 'process.transfer'
  and entity_id = '30000000-0000-0000-0000-000000000001'),
  'audit_logs registrou process.transfer');
select ok(exists(select 1 from public.audit_logs where action = 'process.archive'),
  'audit_logs registrou process.archive');
select ok(exists(select 1 from public.audit_logs where action = 'client.soft_delete'
  and entity_id = '40000000-0000-0000-0000-000000000001'),
  'audit_logs registrou client.soft_delete');
select ok(exists(select 1 from public.audit_logs where action = 'process.soft_delete'
  and entity_id = '30000000-0000-0000-0000-000000000002'),
  'audit_logs registrou process.soft_delete');
select ok(exists(select 1 from public.audit_logs where action = 'process.client.attach'),
  'audit_logs registrou process.client.attach');
select ok(exists(select 1 from public.audit_logs where action = 'court.create' and space_id is null),
  'audit_logs de court é ação de plataforma (space_id null)');

select * from finish();
rollback;
