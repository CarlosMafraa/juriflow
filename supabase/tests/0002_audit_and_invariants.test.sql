-- =============================================================================
-- audit_logs append-only + invariante "ao menos 1 ADMIN ativo por espaço".
-- =============================================================================
begin;
select plan(11);

create function tests_as(uid uuid) returns void
language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text,
    true
  );
$$;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a1',
   'authenticated', 'authenticated', 'admin1@juriflow.test', 'x',
   now(), now(), now(), '{}'::jsonb, '{"full_name":"Admin 1"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2',
   'authenticated', 'authenticated', 'admin2@juriflow.test', 'x',
   now(), now(), now(), '{}'::jsonb, '{"full_name":"Admin 2"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c1',
   'authenticated', 'authenticated', 'colab1@juriflow.test', 'x',
   now(), now(), now(), '{}'::jsonb, '{"full_name":"Colab 1"}'::jsonb);

insert into public.spaces (id, name, slug) values
  ('20000000-0000-0000-0000-000000000001', 'Espaco Aud', 'espaco-aud');

insert into public.space_members (space_id, profile_id, role, status) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'ADMIN', 'active'),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'COLABORADOR', 'active');

-- ---- Invariante do último ADMIN (gatilho dispara independente de papel) ----
select throws_ok(
  $$ delete from public.space_members
     where space_id = '20000000-0000-0000-0000-000000000001'
       and profile_id = '00000000-0000-0000-0000-0000000000a1' $$,
  '23514', null, 'Não é possível remover o último ADMIN ativo do espaço'
);
select throws_ok(
  $$ update public.space_members set role = 'COLABORADOR'
     where space_id = '20000000-0000-0000-0000-000000000001'
       and profile_id = '00000000-0000-0000-0000-0000000000a1' $$,
  '23514', null, 'Não é possível rebaixar o último ADMIN ativo do espaço'
);
select throws_ok(
  $$ update public.space_members set status = 'disabled'
     where space_id = '20000000-0000-0000-0000-000000000001'
       and profile_id = '00000000-0000-0000-0000-0000000000a1' $$,
  '23514', null, 'Não é possível desativar o último ADMIN ativo do espaço'
);

insert into public.space_members (space_id, profile_id, role, status) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', 'ADMIN', 'active');

select lives_ok(
  $$ delete from public.space_members
     where space_id = '20000000-0000-0000-0000-000000000001'
       and profile_id = '00000000-0000-0000-0000-0000000000a1' $$,
  'Com dois ADMINs, remover um é permitido'
);

-- ---- audit_logs: append-only ----
select lives_ok(
  $$ select app.write_audit_log('space.update', '20000000-0000-0000-0000-000000000001',
       'space', '20000000-0000-0000-0000-000000000001', 'success', 'system') $$,
  'app.write_audit_log insere um registro de auditoria'
);
select is(
  (select count(*)::int from public.audit_logs
   where space_id = '20000000-0000-0000-0000-000000000001'),
  1, 'Registro de auditoria persistido'
);
select throws_ok(
  $$ update public.audit_logs set action = 'tampered'
     where space_id = '20000000-0000-0000-0000-000000000001' $$,
  '23001', null, 'UPDATE em audit_logs é bloqueado (append-only)'
);
select throws_ok(
  $$ delete from public.audit_logs
     where space_id = '20000000-0000-0000-0000-000000000001' $$,
  '23001', null, 'DELETE em audit_logs é bloqueado (append-only)'
);

-- ---- Leitura restrita ----
select tests_as('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is(
  (select count(*)::int from public.audit_logs),
  1, 'ADMIN lê a trilha de auditoria do próprio espaço'
);

select tests_as('00000000-0000-0000-0000-0000000000c1');
select is(
  (select count(*)::int from public.audit_logs),
  0, 'COLABORADOR não lê a trilha de auditoria'
);
select throws_ok(
  $$ insert into public.audit_logs (action, actor_type) values ('forged', 'user') $$,
  '42501', null, 'Usuário não pode inserir diretamente em audit_logs'
);

reset role;
select * from finish();
rollback;
