-- =============================================================================
-- Saúde do worker (0044) só para a plataforma, sem dado de escritório; e
-- contador de tentativas dos avisos (0043). Rode com: npm run db:test
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

-- O worker grava como service_role.
set local role service_role;
select lives_ok($$ insert into public.worker_status (worker, last_seen_at, last_source_error, last_source_error_at)
  values ('scraper-worker', now(), 'Request Rejected', now()) $$, 'Worker (service_role) grava o batimento');
reset role;

-- ADMIN de escritório não vê nem grava.
select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select throws_ok($$ select * from public.worker_status $$, '42501', null, 'App não lê a tabela direto');
select throws_ok($$ select * from public.platform_worker_status() $$, '42501', null,
  'ADMIN de escritório não vê a saúde do worker');
select throws_ok($$ insert into public.worker_status (worker) values ('falso') $$, '42501', null,
  'Ninguém do app grava batimento falso');
reset role;

-- Plataforma vê online/parado e o erro do tribunal.
select tests_as('00000000-0000-0000-0000-0000000000f1'); set local role authenticated;
select is((select online from public.platform_worker_status()), true, 'Batimento recente = no ar');
select is((select last_source_error from public.platform_worker_status()), 'Request Rejected',
  'Plataforma vê que o tribunal está bloqueando');
reset role;

update public.worker_status set last_seen_at = now() - interval '10 minutes';
select tests_as('00000000-0000-0000-0000-0000000000f1'); set local role authenticated;
select is((select online from public.platform_worker_status()), false, 'Sem batimento há 10 min = parado');
select ok(not exists (
    select 1 from jsonb_object_keys((select to_jsonb(w) from public.platform_worker_status() w limit 1)) k
    where k like '%space%' or k like '%process%'
  ), 'Saúde do worker não traz nada de escritório nem de processo');
reset role;

-- Tentativas de aviso começam em 1 e não aceitam zero.
select col_default_is('public', 'notification_deliveries', 'attempts', '1', 'Aviso nasce com 1 tentativa');
select col_not_null('public', 'notification_deliveries', 'attempts', 'Tentativas sempre preenchidas');

select * from finish();
rollback;
