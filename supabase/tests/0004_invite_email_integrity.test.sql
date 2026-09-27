-- =============================================================================
-- Convites: o aceite confia no e-mail CONFIRMADO do Auth, não em profiles.email
-- (migração 0030). Rode com: npm run db:test
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
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a1','authenticated','authenticated','adminA@t.test','x',now(),now(),now(),'{}','{"full_name":"Admin A"}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000c1','authenticated','authenticated','attacker@t.test','x',now(),now(),now(),'{}','{"full_name":"Atacante"}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000c2','authenticated','authenticated','convidado@t.test','x',now(),now(),now(),'{}','{"full_name":"Convidado"}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000c3','authenticated','authenticated','naoconfirmado@t.test','x',null,now(),now(),'{}','{"full_name":"Nao confirmado"}');

insert into public.spaces (id, name, slug) values
 ('10000000-0000-0000-0000-00000000000a','Escritorio A','escritorio-a');
insert into public.space_members (space_id, profile_id, role, status) values
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a1','ADMIN','active');

insert into public.space_invites (id, space_id, email, role, invited_by, token) values
 ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a',
  'convidado@t.test','ADMIN','00000000-0000-0000-0000-0000000000a1',
  '60000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000a',
  'naoconfirmado@t.test','COLABORADOR','00000000-0000-0000-0000-0000000000a1',
  '60000000-0000-0000-0000-000000000002'),
 -- Cenário real do ataque: convite para quem AINDA NÃO tem conta.
 ('50000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-00000000000a',
  'semconta@t.test','ADMIN','00000000-0000-0000-0000-0000000000a1',
  '60000000-0000-0000-0000-000000000003');

-- ---- Atacante tenta assumir o e-mail do convidado ----
select tests_as('00000000-0000-0000-0000-0000000000c1'); set local role authenticated;

select throws_ok(
  $$ update public.profiles set email = 'semconta@t.test'
     where id = '00000000-0000-0000-0000-0000000000c1' $$,
  '42501', null,
  'Usuário não consegue alterar o próprio profiles.email');

select is(
  (select count(*)::int from public.my_pending_invites()),
  0, 'Atacante não enxerga convites de outro e-mail');

select throws_ok(
  $$ select public.accept_space_invite('60000000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'Atacante não aceita convite de outro e-mail mesmo conhecendo o token');

reset role;

-- ---- Mesmo que profiles.email divirja (dado legado), o Auth é quem decide ----
-- Sem JWT (contexto de sistema), como uma correção manual via SQL.
select set_config('request.jwt.claims', '', true);
update public.profiles set email = 'semconta@t.test'
 where id = '00000000-0000-0000-0000-0000000000c1';
select tests_as('00000000-0000-0000-0000-0000000000c1'); set local role authenticated;
select is(
  (select count(*)::int from public.my_pending_invites()),
  0, 'Convite é casado pelo e-mail do Auth, não por profiles.email');
select throws_ok(
  $$ select public.accept_space_invite('60000000-0000-0000-0000-000000000003') $$,
  '42501', null,
  'Aceite ignora profiles.email divergente');
reset role;

-- ---- E-mail não confirmado não aceita convite ----
select tests_as('00000000-0000-0000-0000-0000000000c3'); set local role authenticated;
select is(
  (select count(*)::int from public.my_pending_invites()),
  0, 'E-mail não confirmado não lista convites');
select throws_ok(
  $$ select public.accept_space_invite('60000000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'E-mail não confirmado não aceita convite');
reset role;

-- ---- Convidado legítimo continua funcionando ----
select tests_as('00000000-0000-0000-0000-0000000000c2'); set local role authenticated;
select is(
  (select count(*)::int from public.my_pending_invites()),
  1, 'Convidado legítimo vê o próprio convite');
select lives_ok(
  $$ select public.accept_space_invite('60000000-0000-0000-0000-000000000001') $$,
  'Convidado legítimo aceita o convite');
reset role;

select ok(
  exists (select 1 from public.space_members
          where space_id = '10000000-0000-0000-0000-00000000000a'
            and profile_id = '00000000-0000-0000-0000-0000000000c2'
            and role = 'ADMIN' and status = 'active'),
  'Convidado virou membro ativo com o papel do convite');
select ok(
  not exists (select 1 from public.space_members
              where profile_id = '00000000-0000-0000-0000-0000000000c1'),
  'Atacante não virou membro de nada');

-- ---- Mudança de e-mail no Auth é espelhada em profiles ----
-- O GoTrue grava sem JWT de usuário.
select set_config('request.jwt.claims', '', true);
update auth.users set email = 'novo-convidado@t.test'
 where id = '00000000-0000-0000-0000-0000000000c2';
select is(
  (select email::text from public.profiles where id = '00000000-0000-0000-0000-0000000000c2'),
  'novo-convidado@t.test', 'profiles.email acompanha auth.users.email');

select * from finish();
rollback;
