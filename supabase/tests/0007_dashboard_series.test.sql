-- =============================================================================
-- Séries do dashboard (0038): escopo por papel e acesso da plataforma.
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
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a3','authenticated','authenticated','colabA2@t.test','x',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000f1','authenticated','authenticated','super@t.test','x',now(),now(),now(),'{}','{}');
update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-0000000000f1';

insert into public.spaces (id, name, slug, max_processes, max_tracked_processes) values
 ('10000000-0000-0000-0000-00000000000a','Escritorio A','escritorio-a', 100, 100);
insert into public.space_members (space_id, profile_id, role, status) values
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a1','ADMIN','active'),
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a2','COLABORADOR','active'),
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a3','COLABORADOR','active');
insert into public.courts (id, name, type, jurisdiction, active, tracking_source_kind) values
 ('20000000-0000-0000-0000-000000000001','TJ Teste','TJ','ZZ', true, 'projudi_tjam');

insert into public.processes (id, space_id, court_id, created_by, cnj_number) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','0000001-23.2024.8.04.0001'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a3','0000002-23.2024.8.04.0001');
insert into public.process_responsible_history (process_id, responsible_id, reason) values
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','process_created'),
 ('30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a3','process_created');

-- 2 movimentações hoje no P1 (colabA1), 1 hoje no P2 (colabA2), 1 há 40 dias no P1.
insert into public.process_movements (space_id, process_id, description, source_kind, content_hash, collected_at) values
 ('10000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-000000000001','m1','projudi_tjam','h1', now()),
 ('10000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-000000000001','m2','projudi_tjam','h2', now()),
 ('10000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-000000000002','m3','projudi_tjam','h3', now()),
 ('10000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-000000000001','m4','projudi_tjam','h4', now() - interval '40 days');

select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select is((select count(*)::int from public.space_movements_per_day('10000000-0000-0000-0000-00000000000a', 30)), 30,
  'Série tem um ponto por dia (30), inclusive dias sem movimentação');
select is((select sum(total)::int from public.space_movements_per_day('10000000-0000-0000-0000-00000000000a', 30)), 3,
  'ADMIN conta as 3 movimentações do espaço nos últimos 30 dias (a de 40 dias fica de fora)');

select tests_as('00000000-0000-0000-0000-0000000000a2');
select is((select sum(total)::int from public.space_movements_per_day('10000000-0000-0000-0000-00000000000a', 30)), 2,
  'COLABORADOR conta só as movimentações dos processos dele (RLS)');

select tests_as('00000000-0000-0000-0000-0000000000f1');
select is((select sum(total)::int from public.space_movements_per_day('10000000-0000-0000-0000-00000000000a', 30)), 0,
  'SUPER_ADMIN não enxerga movimentações de nenhum espaço');
select is((select count(*)::int from public.platform_growth(6)), 6, 'Crescimento da plataforma: 6 meses');
select ok((select sum(new_spaces) from public.platform_growth(6)) >= 1, 'Conta o espaço criado neste mês');
select ok((select sum(new_users) from public.platform_growth(6)) >= 4, 'Conta as contas criadas neste mês');

select tests_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select * from public.platform_growth(6) $$, '42501', null,
  'ADMIN de espaço não vê o crescimento da plataforma');

select * from finish();
rollback;
