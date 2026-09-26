-- =============================================================================
-- Convite de escritório e regras do link (0039):
--   convite do SUPER_ADMIN = espaço novo aguardando configuração;
--   link aberto ou não; expira em 24 h; reenviar invalida o anterior.
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
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000f1','authenticated','authenticated','super@t.test','x',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000c1','authenticated','authenticated','intruso@t.test','x',now(),now(),now(),'{}','{}');
update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-0000000000f1';

-- =============================================================================
-- SUPER_ADMIN cria o escritório convidando o ADMIN
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000f1'); set local role authenticated;

create temp table t_ids (k text primary key, v uuid) on commit drop;
grant all on t_ids to authenticated;

insert into t_ids select 'space', space_id from public.create_space_for_admin('Dono@Escritorio.Test');
select is((select setup_completed_at from public.spaces where id = (select v from t_ids where k = 'space')),
  null::timestamptz, 'Escritório novo nasce aguardando configuração');
select is((select admin_email::text from public.platform_spaces() where id = (select v from t_ids where k = 'space')),
  'dono@escritorio.test', 'Plataforma vê o e-mail do ADMIN convidado (normalizado)');
select is((select invite_state from public.platform_spaces() where id = (select v from t_ids where k = 'space')),
  'sent', 'Convite aparece como enviado e ainda não aberto');
select ok((select invite_expires_at - invite_sent_at from public.platform_spaces()
           where id = (select v from t_ids where k = 'space')) = interval '24 hours',
  'Link vale 24 horas');

insert into t_ids select 'invite1', invite_id from public.platform_spaces() where id = (select v from t_ids where k = 'space');
select is((select account from public.invite_delivery_info((select v from t_ids where k = 'invite1'))),
  'none', 'Delivery info: pessoa ainda sem conta');

-- Reenvio: o convite anterior fica substituído e só o novo vale.
insert into t_ids select 'invite2', public.reissue_space_invite((select v from t_ids where k = 'invite1'));
select isnt((select v from t_ids where k = 'invite2'), (select v from t_ids where k = 'invite1'),
  'Reenvio cria um convite novo');
select is((select invite_id from public.platform_spaces() where id = (select v from t_ids where k = 'space')),
  (select v from t_ids where k = 'invite2'), 'Plataforma acompanha só o convite mais recente');
select throws_ok(
  format('select * from public.invite_delivery_info(%L)', (select v from t_ids where k = 'invite1')),
  '23514', null, 'Link antigo (substituído) não pode mais ser entregue');

-- =============================================================================
-- Quem não é o convidado não usa o link
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok(
  format('select * from public.open_space_invite(%L)', (select v from t_ids where k = 'invite2')),
  '42501', null, 'Outra conta não abre o convite de outra pessoa');
select throws_ok(
  format('select public.reissue_space_invite(%L)', (select v from t_ids where k = 'invite2')),
  '42501', null, 'Outra conta não reenvia convites');
select throws_ok(
  $$ select * from public.create_space_for_admin('x@y.test') $$,
  '42501', null, 'Só a plataforma cria escritórios');

-- =============================================================================
-- O ADMIN convidado abre o link (conta criada pelo convite do Auth)
-- =============================================================================
reset role;
select set_config('request.jwt.claims', '', true);
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a1','authenticated','authenticated','dono@escritorio.test','x',now(),now(),now(),'{}','{}');

select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select is((select state from public.open_space_invite((select v from t_ids where k = 'invite1'))),
  'superseded', 'Abrir o link antigo informa que foi substituído');
select is((select state from public.open_space_invite((select v from t_ids where k = 'invite2'))),
  'opened', 'Abrir o link novo marca o convite como aberto');
select ok((select setup_pending from public.open_space_invite((select v from t_ids where k = 'invite2'))),
  'Tela sabe que o escritório ainda precisa ser configurado');
select throws_ok(
  format('select public.accept_space_invite_by_id(%L)', (select v from t_ids where k = 'invite1')),
  'P0002', null, 'Convite substituído não pode ser aceito');
select lives_ok(
  format('select public.accept_space_invite_by_id(%L)', (select v from t_ids where k = 'invite2')),
  'Convite novo é aceito');
select ok(app.is_space_admin((select v from t_ids where k = 'space')), 'Quem aceitou virou ADMIN do escritório');
select lives_ok(
  format('select public.complete_space_setup(%L, %L)', (select v from t_ids where k = 'space'), 'Escritório Silva & Souza'),
  'ADMIN completa os dados do escritório');
select throws_ok(
  format('update public.spaces set admin_email = %L where id = %L', 'outro@t.test', (select v from t_ids where k = 'space')),
  '42501', null, 'ADMIN não altera o e-mail de ADMIN registrado pela plataforma');

-- =============================================================================
-- Plataforma vê o resultado (só por fora)
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000f1');
select is((select name from public.platform_spaces() where id = (select v from t_ids where k = 'space')),
  'Escritório Silva & Souza', 'Plataforma vê o nome definido pelo ADMIN');
select is((select invite_state from public.platform_spaces() where id = (select v from t_ids where k = 'space')),
  'accepted', 'Convite aparece como aceito');
select isnt((select setup_completed_at from public.platform_spaces() where id = (select v from t_ids where k = 'space')),
  null::timestamptz, 'Escritório aparece como configurado');
select is((select count(*)::int from public.profiles), 1, 'Plataforma só lê o próprio perfil');
select is((select users from public.platform_overview()), 3, 'Mas conhece o total de contas');
select throws_ok(
  format('select public.reissue_space_invite(%L)', (select v from t_ids where k = 'invite2')),
  '42501', null, 'Depois de configurado, o espaço é do ADMIN: a plataforma não reenvia convites dele');

-- =============================================================================
-- ADMIN -> colaborador: mesmas regras de link
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a1');
insert into t_ids select 'colab1', public.create_space_invite((select v from t_ids where k = 'space'), 'colab@t.test', 'COLABORADOR');
insert into t_ids select 'colab2', public.create_space_invite((select v from t_ids where k = 'space'), 'colab@t.test', 'COLABORADOR');
select is((select count(*)::int from public.space_invites
           where email = 'colab@t.test' and status = 'pending'), 1,
  'Convidar de novo o mesmo e-mail deixa só um convite válido');
select isnt((select superseded_at from public.space_invites where id = (select v from t_ids where k = 'colab1')),
  null::timestamptz, 'O convite anterior do colaborador fica substituído');

-- Expirado: 25 h depois do envio.
reset role;
update public.space_invites set expires_at = now() - interval '1 hour'
 where id = (select v from t_ids where k = 'colab2');
select set_config('request.jwt.claims', '', true);
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000b1','authenticated','authenticated','colab@t.test','x',now(),now(),now(),'{}','{}');
select tests_as('00000000-0000-0000-0000-0000000000b1'); set local role authenticated;
select is((select state from public.open_space_invite((select v from t_ids where k = 'colab2'))),
  'expired', 'Link com mais de 24 h aparece como expirado');
select is((select opened_at from public.space_invites where id = (select v from t_ids where k = 'colab2')),
  null::timestamptz, 'Abrir um link expirado não conta como aberto');
select throws_ok(
  format('select public.accept_space_invite_by_id(%L)', (select v from t_ids where k = 'colab2')),
  '22000', null, 'Convite expirado não pode ser aceito');

select tests_as('00000000-0000-0000-0000-0000000000a1');
insert into t_ids select 'colab3', public.reissue_space_invite((select v from t_ids where k = 'colab2'));
select tests_as('00000000-0000-0000-0000-0000000000b1');
select lives_ok(
  format('select public.accept_space_invite_by_id(%L)', (select v from t_ids where k = 'colab3')),
  'Reenviado, o colaborador aceita o link novo');

select * from finish();
rollback;
