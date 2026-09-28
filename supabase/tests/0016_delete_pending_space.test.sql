-- =============================================================================
-- 0050 — plataforma exclui escritório aguardando configuração (e só esse).
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
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000f1','authenticated','authenticated','plataforma@t.test','x',now(),now(),now(),'{}','{}');
update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-0000000000f1';

-- Configurado (o ADMIN já entrou).
insert into public.spaces (id, name, slug, setup_completed_at) values
 ('10000000-0000-0000-0000-00000000000a','Escritorio A','escritorio-a', now());
insert into public.space_members (space_id, profile_id, role, status) values
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a1','ADMIN','active');

-- Pendente: criado pela plataforma, convite enviado, ninguém entrou.
select tests_as('00000000-0000-0000-0000-0000000000f1'); set local role authenticated;
select lives_ok($$ select * from public.create_space_for_admin('novo@t.test') $$,
  'Plataforma cria escritório novo (aguardando configuração)');
reset role;
create temp table pend as
  select id from public.spaces where admin_email = 'novo@t.test';
grant select on pend to authenticated;
-- Um evento do escritório na auditoria: com a chave estrangeira antiga, ele
-- impediria a exclusão (a auditoria não aceita UPDATE).
select app.write_audit_log('space.invite.opened', (select id from pend), 'space', (select id::text from pend));
select is((select count(*)::int from public.space_invites where space_id = (select id from pend)), 1,
  'Convite do ADMIN criado');

-- ---- Quem pode e o quê ----
select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select throws_ok($$ select public.platform_delete_pending_space((select id from pend)) $$,
  '42501', null, 'ADMIN de escritório não exclui escritórios');
reset role;

select tests_as('00000000-0000-0000-0000-0000000000f1'); set local role authenticated;
select throws_ok($$ select public.platform_delete_pending_space('10000000-0000-0000-0000-00000000000a') $$,
  '23514', null, 'Escritório configurado não é excluído (só suspenso)');
select lives_ok($$ select public.platform_delete_pending_space((select id from pend)) $$,
  'Plataforma exclui escritório aguardando configuração');
reset role;

select is((select count(*)::int from public.spaces where id = (select id from pend)), 0, 'Escritório apagado');
select is((select count(*)::int from public.space_invites where space_id = (select id from pend)), 0,
  'Convite apagado junto (o link deixa de valer)');
select ok(exists(select 1 from public.audit_logs where space_id = (select id from pend)),
  'Histórico da auditoria do escritório continua lá');
select ok(exists(select 1 from public.audit_logs
                  where action = 'space.delete' and space_id is null
                    and entity_id = (select id::text from pend)),
  'Exclusão auditada como ação da plataforma');
select is((select count(*)::int from public.spaces where id = '10000000-0000-0000-0000-00000000000a'), 1,
  'Escritório configurado continua existindo');

select * from finish();
rollback;
