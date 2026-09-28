-- =============================================================================
-- 0049 — catálogo de planos: plano padrão, atribuição, exceção por espaço e
-- carência anti-rodízio definida no plano. Rode com: npm run db:test
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
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000f1','authenticated','authenticated','plataforma@t.test','x',now(),now(),now(),'{}','{}');
update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-0000000000f1';

insert into public.spaces (id, name, slug) values ('10000000-0000-0000-0000-00000000000a','Escritorio A','escritorio-a');
insert into public.space_members (space_id, profile_id, role, status) values
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a1','ADMIN','active');
insert into public.courts (id, name, type, jurisdiction, active, tracking_source_kind) values
 ('20000000-0000-0000-0000-000000000001','TJ Teste','TJ','ZZ', true, 'projudi_tjam');

select is((select p.name from public.spaces s join public.plans p on p.id = s.plan_id
            where s.id = '10000000-0000-0000-0000-00000000000a'), 'Free',
  'Espaço novo entra no plano padrão (Free)');

-- =============================================================================
-- O espaço vê o próprio plano, mas não a lista nem mexe nela
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select results_eq(
  $$ select plan_name, max_processes, max_tracked_processes, tracking_hold_days
       from public.space_plan_usage('10000000-0000-0000-0000-00000000000a') $$,
  $$ values ('Free'::text, 10, 3, 30) $$,
  'ADMIN vê o plano do espaço (nome, limites e carência)');
select is((select count(*)::int from public.plans), 0, 'ADMIN não lê a lista de planos');
select throws_ok($$ select * from public.platform_plans() $$, '42501', null,
  'ADMIN não usa as funções de plano da plataforma');
select throws_ok($$ update public.spaces set plan_id = plan_id, max_tracked_processes = 99
  where id = '10000000-0000-0000-0000-00000000000a' $$, '42501', null,
  'ADMIN não muda o próprio plano nem cria exceção');
reset role;

-- =============================================================================
-- SUPER_ADMIN: planos, atribuição e exceção
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000f1'); set local role authenticated;
select lives_ok($$ select public.platform_save_plan(null, 'Pro', 100, 2, 7) $$, 'SUPER_ADMIN cria o plano Pro');
select throws_ok($$ select public.platform_save_plan(null, ' pro ', 1, 1, 1) $$, '23505', null,
  'Nome de plano não repete');
select lives_ok($$ select public.platform_set_space_plan('10000000-0000-0000-0000-00000000000a',
  (select id from public.plans where name = 'Pro')) $$, 'SUPER_ADMIN passa o escritório para o Pro');
select is((select spaces_count from public.platform_plans() where name = 'Pro'), 1,
  'Lista de planos conta os escritórios de cada um');
select results_eq(
  $$ select plan_name, max_processes, max_tracked_processes, tracking_hold_days,
            override_max_tracked_processes
       from public.platform_spaces() $$,
  $$ values ('Pro'::text, 100, 2, 7, null::int) $$,
  'Escritório segue os números do plano');
select lives_ok($$ select public.platform_set_space_plan('10000000-0000-0000-0000-00000000000a',
  (select id from public.plans where name = 'Pro'), null, 1, null) $$,
  'Exceção: só 1 sincronizado para este escritório');
select is((select max_tracked_processes from public.platform_spaces()), 1, 'Exceção vale no lugar do plano');
select is((select max_processes from public.platform_spaces()), 100, 'O resto continua seguindo o plano');
select throws_ok($$ select public.platform_delete_plan((select id from public.plans where name = 'Pro')) $$,
  '23514', 'Há escritórios neste plano. Mude-os de plano antes de excluir.', 'Plano em uso não é excluído');
select throws_ok($$ select public.platform_delete_plan((select id from public.plans where is_default)) $$,
  '23514', 'O plano padrão não pode ser excluído.', 'Plano padrão não é excluído');
select lives_ok($$ select public.platform_save_plan(null, 'Temporario', 1, 1, 1) $$, 'Cria um plano avulso');
select lives_ok($$ select public.platform_delete_plan((select id from public.plans where name = 'Temporario')) $$,
  'Plano sem escritórios é excluído');
reset role;
select ok(exists(select 1 from public.audit_logs where action = 'platform.plan.create' and space_id is null),
  'Criação de plano auditada como ação da plataforma');
select ok(exists(select 1 from public.audit_logs where action = 'space.plan.update'),
  'Troca de plano do escritório auditada');

-- =============================================================================
-- Limites e carência do plano valendo nos processos
-- =============================================================================
insert into public.processes (id, space_id, court_id, created_by, cnj_number) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','0000001-23.2024.8.04.0001'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','0000002-23.2024.8.04.0001');

select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select lives_ok($$ update public.processes set tracking_enabled = true
  where id = '30000000-0000-0000-0000-000000000001' $$, 'Liga o 1º (exceção = 1 vaga)');
select throws_ok($$ update public.processes set tracking_enabled = true
  where id = '30000000-0000-0000-0000-000000000002' $$, '23514', null, 'O 2º passa da exceção');
select lives_ok($$ update public.processes set tracking_enabled = false
  where id = '30000000-0000-0000-0000-000000000001' $$, 'Desliga o 1º');
reset role;

update public.processes set tracking_released_at = now() - interval '5 days'
 where id = '30000000-0000-0000-0000-000000000001';
select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select throws_ok($$ update public.processes set tracking_enabled = true
  where id = '30000000-0000-0000-0000-000000000002' $$, '23514', null,
  'Carência do plano (7 dias) ainda segura a vaga no 5º dia');
reset role;

update public.processes set tracking_released_at = now() - interval '8 days'
 where id = '30000000-0000-0000-0000-000000000001';
select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select lives_ok($$ update public.processes set tracking_enabled = true
  where id = '30000000-0000-0000-0000-000000000002' $$,
  'Passada a carência do plano, a vaga fica livre');
reset role;

select * from finish();
rollback;
