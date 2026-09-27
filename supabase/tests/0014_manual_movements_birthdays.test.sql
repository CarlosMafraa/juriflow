-- =============================================================================
-- 0048 — movimentações manuais (uma fonte por vez, anti-burla), vaga de
-- sincronização presa 30 dias, 1ª sincronização sem histórico, aniversário.
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
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a2','authenticated','authenticated','colabA@t.test','x',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a3','authenticated','authenticated','colabB@t.test','x',now(),now(),now(),'{}','{}');

insert into public.spaces (id, name, slug, max_processes, max_tracked_processes)
values ('10000000-0000-0000-0000-00000000000a','Escritorio A','escritorio-a', 10, 1);
insert into public.space_members (space_id, profile_id, role, status) values
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a1','ADMIN','active'),
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a2','COLABORADOR','active'),
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a3','COLABORADOR','active');
insert into public.courts (id, name, type, jurisdiction, active, tracking_source_kind) values
 ('20000000-0000-0000-0000-000000000001','TJ Teste','TJ','ZZ', true, 'projudi_tjam');

-- P1: cadastrado pela colabA (a2), que é a responsável; colabB (a3) também é responsável.
insert into public.processes (id, space_id, court_id, created_by, cnj_number) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','0000001-23.2024.8.04.0001'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','0000002-23.2024.8.04.0001');
insert into public.process_responsible_history (process_id, responsible_id, assigned_by, reason) values
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a2','process_created'),
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a1','added'),
 ('30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1','process_created');

-- Movimentação do tribunal já coletada no P1 (de uma sincronização antiga).
insert into public.process_movements (id, space_id, process_id, source_kind, description, occurred_at, content_hash)
values ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a',
  '30000000-0000-0000-0000-000000000001','projudi_tjam','SENTENÇA DO TRIBUNAL', now() - interval '2 days','h1');

-- =============================================================================
-- Modo manual: cadastro, visibilidade, permissões
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a3'); set local role authenticated;
select is((select count(*)::int from public.process_movements
            where process_id = '30000000-0000-0000-0000-000000000001'), 0,
  'Sem sincronização, a movimentação do tribunal NÃO aparece (anti-burla)');
select lives_ok($$ select public.create_manual_movement('30000000-0000-0000-0000-000000000001',
  current_date - 1, 'Audiência realizada', 'Acordo proposto') $$,
  'Responsável cadastra movimentação manual');
select is((select description from public.process_movements
            where process_id = '30000000-0000-0000-0000-000000000001'),
  E'Audiência realizada\nAcordo proposto', 'Só a manual aparece, com título e detalhe');
select throws_ok($$ select public.create_manual_movement('30000000-0000-0000-0000-000000000001',
  current_date + 1, 'Futuro', null) $$, '23514', 'A data da movimentação não pode ser no futuro.',
  'Data no futuro é recusada');
select throws_ok($$ select public.create_manual_movement('30000000-0000-0000-0000-000000000001',
  current_date, '  ', null) $$, '23514', null, 'Título vazio é recusado');
select throws_ok($$ select public.create_manual_movement('30000000-0000-0000-0000-000000000002',
  current_date, 'Intrusa', null) $$, '42501', null, 'Não responsável não cadastra');
select throws_ok($$ insert into public.process_movements (space_id, process_id, source_kind, description, content_hash)
  values ('10000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-000000000001','manual','x','x') $$,
  '42501', null, 'Insert direto na tabela continua proibido (só pela RPC)');

-- colabB é responsável, mas não cadastrou o processo: não corrige nem exclui.
select throws_ok($$ select public.update_manual_movement(
  (select id from public.process_movements where source_kind = 'manual' limit 1),
  current_date, 'Editada', null) $$, '42501', null,
  'Responsável que não cadastrou o processo não corrige');
reset role;

select tests_as('00000000-0000-0000-0000-0000000000a2'); set local role authenticated;
select lives_ok($$ select public.update_manual_movement(
  (select id from public.process_movements where source_kind = 'manual' limit 1),
  current_date - 2, 'Audiência de conciliação', null) $$,
  'Quem cadastrou o processo corrige');
reset role;
select ok(exists(select 1 from public.audit_logs where action = 'process.movement.manual.update'),
  'Correção auditada');
select ok(exists(select 1 from public.audit_logs where action = 'process.movement.manual.create'),
  'Cadastro auditado');
select ok(exists(select 1 from public.notification_catchup_requests
                  where process_id = '30000000-0000-0000-0000-000000000001'),
  'Movimentação manual entra na fila de avisos');

-- =============================================================================
-- Ligar a sincronização: 1ª coleta sem histórico; manual some, tribunal volta
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select lives_ok($$ update public.processes set tracking_enabled = true
  where id = '30000000-0000-0000-0000-000000000001' $$, 'ADMIN liga a sincronização do P1');
select is((select description from public.process_movements
            where process_id = '30000000-0000-0000-0000-000000000001'),
  'SENTENÇA DO TRIBUNAL', 'Com sincronização, só as do tribunal aparecem (manual guardada)');
select throws_ok($$ select public.create_manual_movement('30000000-0000-0000-0000-000000000001',
  current_date, 'Manual com sync', null) $$, '23514',
  'Com a sincronização automática ligada, as movimentações vêm do tribunal.',
  'Com sincronização ligada, não cadastra manual');
reset role;
select ok((select sync_baseline_pending from public.processes where id = '30000000-0000-0000-0000-000000000001'),
  'Tinha manual: a 1ª coleta só registra o histórico, sem avisar');

-- =============================================================================
-- Anti-rodízio: desligar segura a vaga por 30 dias
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select lives_ok($$ update public.processes set tracking_enabled = false
  where id = '30000000-0000-0000-0000-000000000001' $$, 'ADMIN desliga a sincronização do P1');
select is((select used_tracked from public.space_plan_usage('10000000-0000-0000-0000-00000000000a')), 1,
  'A vaga continua ocupada depois de desligar');
select throws_ok($$ update public.processes set tracking_enabled = true
  where id = '30000000-0000-0000-0000-000000000002' $$, '23514', null,
  'Não dá para usar a vaga em outro processo (rodízio)');
select lives_ok($$ update public.processes set tracking_enabled = true
  where id = '30000000-0000-0000-0000-000000000001' $$,
  'Religar o MESMO processo dentro dos 30 dias usa a própria vaga');
select lives_ok($$ update public.processes set status = 'archived'
  where id = '30000000-0000-0000-0000-000000000001' $$, 'Arquivar o processo sincronizado');
select throws_ok($$ update public.processes set tracking_enabled = true
  where id = '30000000-0000-0000-0000-000000000002' $$, '23514', null,
  'Arquivar também segura a vaga (rodízio pelo arquivo)');
reset role;
select ok(not (select sync_baseline_pending from public.processes where id = '30000000-0000-0000-0000-000000000001'),
  'Fora da sincronização, a marca da 1ª coleta some');
update public.processes set tracking_released_at = now() - interval '31 days'
 where id = '30000000-0000-0000-0000-000000000001';
select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select lives_ok($$ update public.processes set tracking_enabled = true
  where id = '30000000-0000-0000-0000-000000000002' $$, 'Depois de 30 dias a vaga fica livre');
reset role;

-- A auditoria da coleta não guarda o texto do tribunal.
select ok(not exists(select 1 from public.audit_logs
                      where action = 'process.movement.collected'
                        and after::text like '%SENTENÇA%'),
  'Auditoria da coleta não guarda o texto da movimentação');

-- =============================================================================
-- Aniversário
-- =============================================================================
select tests_as('00000000-0000-0000-0000-0000000000a2'); set local role authenticated;
select lives_ok($$ update public.profiles set birth_date = '1990-05-10'
  where id = '00000000-0000-0000-0000-0000000000a2' $$, 'Colaboradora informa o próprio aniversário');
select throws_ok($$ insert into public.message_templates (space_id, name, audience, kind, body, created_by)
  values ('10000000-0000-0000-0000-00000000000a','Parabéns','team','birthday','Oi {{nome}}',
          '00000000-0000-0000-0000-0000000000a2') $$, '42501', null,
  'Colaborador não cria template de aniversário');
reset role;

select tests_as('00000000-0000-0000-0000-0000000000a1'); set local role authenticated;
select lives_ok($$ insert into public.message_templates (id, space_id, name, audience, kind, body, created_by)
  values ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','Parabéns equipe','team','birthday',
          'Feliz aniversário, {{nome}}!','00000000-0000-0000-0000-0000000000a1') $$,
  'ADMIN cria template de aniversário da equipe');
select throws_ok($$ insert into public.message_templates (space_id, name, audience, kind, body, created_by)
  values ('10000000-0000-0000-0000-00000000000a','Errado','team','movement','x','00000000-0000-0000-0000-0000000000a1') $$,
  '23514', null, 'Template de movimentação não aceita o público equipe');
select lives_ok($$ insert into public.space_notification_configs (space_id, team_birthday_template_id)
  values ('10000000-0000-0000-0000-00000000000a','60000000-0000-0000-0000-000000000001') $$,
  'ADMIN escolhe o template de aniversário da equipe');
select throws_ok($$ update public.space_notification_configs
  set client_birthday_template_id = '60000000-0000-0000-0000-000000000001'
  where space_id = '10000000-0000-0000-0000-00000000000a' $$, '23514', null,
  'Template da equipe não serve para clientes');
select throws_ok($$ update public.space_notification_configs
  set responsible_template_id = '60000000-0000-0000-0000-000000000001'
  where space_id = '10000000-0000-0000-0000-00000000000a' $$, '23514', null,
  'Template de aniversário não serve para aviso de movimentação');
select throws_ok($$ select * from public.birthday_greetings $$, '42501', null,
  'Registro dos parabéns é só do worker');
select throws_ok($$ select * from public.worker_birthdays_on(current_date) $$, '42501', null,
  'Lista de aniversariantes é só do worker');
reset role;

update public.profiles set phone = '+5592900000002' where id = '00000000-0000-0000-0000-0000000000a2';
update public.profiles set phone = '+5592900000003', birth_date = '2000-02-29'
 where id = '00000000-0000-0000-0000-0000000000a3';
insert into public.clients (space_id, type, name, phone, birth_date, notification_opt_in, opt_in_at, created_by) values
 ('10000000-0000-0000-0000-00000000000a','PF','Cliente Com Aceite','+5592911110001','1980-05-10', true, now(),
  '00000000-0000-0000-0000-0000000000a1'),
 ('10000000-0000-0000-0000-00000000000a','PF','Cliente Sem Aceite','+5592911110002','1981-05-10', false, null,
  '00000000-0000-0000-0000-0000000000a1');
select set_eq($$ select full_name from public.worker_birthdays_on('2027-05-10') $$,
  $$ values ('Cliente Com Aceite'), ((select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000a2')) $$,
  'Aniversariantes do dia: equipe com telefone e cliente só com aceite de avisos');
select is((select count(*)::int from public.worker_birthdays_on('2027-02-28')), 1,
  'Em ano não bissexto, quem nasceu em 29/02 comemora em 28/02');
select is((select count(*)::int from public.worker_birthdays_on('2028-02-28')), 0,
  'Em ano bissexto, 28/02 não pega quem nasceu em 29/02');
select is((select count(*)::int from public.worker_birthdays_on('2028-02-29')), 1,
  'Em ano bissexto, comemora em 29/02');

select * from finish();
rollback;
