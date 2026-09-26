-- =============================================================================
-- SUPER_ADMIN único, criado só pelo comando auditado (0040), e plataforma que
-- vê e altera escritórios só pelas funções próprias. Rode com: npm run db:test
-- =============================================================================
begin;
select * from no_plan();

create function tests_rowcount(stmt text) returns int
language plpgsql as $$
declare n int;
begin execute stmt; get diagnostics n = row_count; return n; end;
$$;

create function tests_as(uid uuid) returns void
language sql security definer set search_path = '' as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000f1','authenticated','authenticated','dono.plataforma@t.test','x',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000f2','authenticated','authenticated','outro@t.test','x',now(),now(),now(),'{}','{}');

-- Nenhum SUPER_ADMIN ainda: um usuário logado não consegue se promover.
select tests_as('00000000-0000-0000-0000-0000000000f2'); set local role authenticated;
select throws_ok($$ select public.bootstrap_super_admin('outro@t.test') $$, '42501', null,
  'Usuário logado não executa o bootstrap');
select throws_ok($$ update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-0000000000f2' $$,
  '42501', null, 'Usuário não se promove a SUPER_ADMIN pelo próprio perfil');
reset role;

-- O comando de bootstrap roda como service_role.
select set_config('request.jwt.claims', '', true);
set local role service_role;
select lives_ok($$ select public.bootstrap_super_admin('Dono.Plataforma@t.test') $$,
  'Bootstrap promove o primeiro SUPER_ADMIN');
select throws_ok($$ select public.bootstrap_super_admin('outro@t.test') $$, '23514', null,
  'Bootstrap só funciona enquanto não existe SUPER_ADMIN');
reset role;

select ok(exists(select 1 from public.audit_logs
                 where action = 'platform.super_admin.grant'
                   and entity_id = '00000000-0000-0000-0000-0000000000f1'
                   and context ->> 'via' = 'bootstrap'),
  'A criação do SUPER_ADMIN fica na auditoria');
select throws_ok($$ update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-0000000000f2' $$,
  '23505', null, 'O banco impede um segundo SUPER_ADMIN, mesmo por fora do app');

-- Plataforma: escritórios só pelas funções próprias.
insert into public.spaces (id, name, slug) values ('10000000-0000-0000-0000-00000000000a', 'Escritorio A', 'escritorio-a');
select tests_as('00000000-0000-0000-0000-0000000000f1'); set local role authenticated;
select is((select count(*)::int from public.spaces), 0, 'SUPER_ADMIN não lê a tabela de escritórios');
select is((select count(*)::int from public.platform_spaces()), 1, 'Mas sabe que o escritório existe');
select ok(
  not exists (
    select 1 from jsonb_object_keys((select to_jsonb(p) from public.platform_spaces() p limit 1)) k
    where k like '%color%'
  ),
  'A lista da plataforma não traz colunas internas do escritório (cores)');
select lives_ok($$ select public.platform_set_space_plan('10000000-0000-0000-0000-00000000000a', 20, 5) $$,
  'Plano pela função da plataforma');
select is(tests_rowcount($$ update public.spaces set status = 'suspended'
  where id = '10000000-0000-0000-0000-00000000000a' $$), 0,
  'Plataforma não altera escritório por UPDATE direto (só pelas funções auditadas)');

select * from finish();
rollback;
