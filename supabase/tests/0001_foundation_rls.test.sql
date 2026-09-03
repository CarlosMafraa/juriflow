-- =============================================================================
-- RLS da fundação: isolamento por espaço, papéis e SUPER_ADMIN.
-- Rode com: npm run db:test   (requer Docker + supabase start)
-- =============================================================================
begin;
select plan(22);

-- --- helper: define o "usuário logado" (claims do JWT). ----------------------
-- A troca de ROLE é feita com `set local role` no próprio script (o runner
-- conecta como superusuário); `set role` não é permitido dentro de função.
create function tests_as(uid uuid) returns void
language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text,
    true
  );
$$;

-- Executa um comando e devolve quantas linhas afetou (respeitando a RLS do
-- papel/claims atuais). Usado para checar filtros silenciosos da RLS.
create function tests_rowcount(stmt text) returns int
language plpgsql as $$
declare n int;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;

-- --- fixtures (inseridas como postgres/BYPASSRLS) ---------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'super@juriflow.test', 'x',
   now(), now(), now(), '{}'::jsonb, '{"full_name":"Super"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'admin.a@juriflow.test', 'x',
   now(), now(), now(), '{}'::jsonb, '{"full_name":"Admin A"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000003',
   'authenticated', 'authenticated', 'colab.a@juriflow.test', 'x',
   now(), now(), now(), '{}'::jsonb, '{"full_name":"Colab A"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000004',
   'authenticated', 'authenticated', 'admin.b@juriflow.test', 'x',
   now(), now(), now(), '{}'::jsonb, '{"full_name":"Admin B"}'::jsonb);

update public.profiles set is_super_admin = true
  where id = '00000000-0000-0000-0000-000000000001';

insert into public.spaces (id, name, slug) values
  ('10000000-0000-0000-0000-000000000001', 'Escritorio A', 'escritorio-a'),
  ('10000000-0000-0000-0000-000000000002', 'Escritorio B', 'escritorio-b');

insert into public.space_members (space_id, profile_id, role, status) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'ADMIN', 'active'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'COLABORADOR', 'active'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', 'ADMIN', 'active');

-- =============================================================================
select is(
  (select count(*)::int from public.profiles),
  4,
  'trigger handle_new_user criou 1 profile por auth.users'
);

-- ---- Admin A ----
select tests_as('00000000-0000-0000-0000-000000000002');
set local role authenticated;

select is(
  (select count(*)::int from public.profiles),
  2,
  'Admin A vê apenas perfis do próprio espaço (ele + colaborador)'
);
select ok(
  exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-000000000003'),
  'Admin A vê o perfil do colaborador do mesmo espaço'
);
select ok(
  not exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-000000000004'),
  'Admin A NÃO vê o perfil do admin do espaço B'
);
select is(
  (select count(*)::int from public.spaces),
  1,
  'Admin A enxerga somente o espaço A'
);
select is(
  tests_rowcount(
    $$ update public.spaces set name = 'Renomeado A'
       where id = '10000000-0000-0000-0000-000000000001' $$
  ),
  1,
  'Admin A pode renomear o próprio espaço'
);
select is(
  tests_rowcount(
    $$ update public.spaces set name = 'invasao'
       where id = '10000000-0000-0000-0000-000000000002' $$
  ),
  0,
  'Admin A NÃO consegue alterar o espaço B (0 linhas)'
);
select throws_ok(
  $$ update public.spaces set status = 'suspended'
     where id = '10000000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'Admin A NÃO pode suspender o próprio espaço (status é do SUPER_ADMIN)'
);
select throws_ok(
  $$ insert into public.spaces (name, slug) values ('Novo', 'novo-espaco') $$,
  '42501',
  null,
  'Admin A NÃO pode criar espaço'
);
select lives_ok(
  $$ insert into public.space_members (space_id, profile_id, role, status)
     values ('10000000-0000-0000-0000-000000000001',
             '00000000-0000-0000-0000-000000000001', 'COLABORADOR', 'active') $$,
  'Admin A adiciona membro no próprio espaço'
);
select throws_ok(
  $$ insert into public.space_members (space_id, profile_id, role, status)
     values ('10000000-0000-0000-0000-000000000002',
             '00000000-0000-0000-0000-000000000003', 'COLABORADOR', 'active') $$,
  '42501',
  null,
  'Admin A NÃO adiciona membro no espaço B'
);

-- ---- Colaborador A ----
select tests_as('00000000-0000-0000-0000-000000000003');

select is(
  (select count(*)::int from public.space_members
   where space_id = '10000000-0000-0000-0000-000000000001'),
  3,
  'Colaborador vê a lista de membros do próprio espaço'
);
select is(
  (select count(*)::int from public.space_members
   where space_id = '10000000-0000-0000-0000-000000000002'),
  0,
  'Colaborador NÃO vê membros do espaço B'
);
select throws_ok(
  $$ insert into public.space_members (space_id, profile_id, role, status)
     values ('10000000-0000-0000-0000-000000000001',
             '00000000-0000-0000-0000-000000000004', 'COLABORADOR', 'active') $$,
  '42501',
  null,
  'Colaborador NÃO pode adicionar membros'
);
select is(
  tests_rowcount(
    $$ update public.space_members set role = 'ADMIN'
       where profile_id = '00000000-0000-0000-0000-000000000003' $$
  ),
  0,
  'Colaborador NÃO consegue se promover a ADMIN (0 linhas)'
);
select throws_ok(
  $$ update public.profiles set is_super_admin = true
     where id = '00000000-0000-0000-0000-000000000003' $$,
  '42501',
  null,
  'Colaborador NÃO pode se tornar SUPER_ADMIN pelo próprio perfil'
);

-- ---- SUPER_ADMIN ----
select tests_as('00000000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.spaces),
  2,
  'SUPER_ADMIN enxerga todos os espaços'
);
select is(
  (select count(*)::int from public.profiles),
  4,
  'SUPER_ADMIN enxerga todos os perfis'
);
select lives_ok(
  $$ insert into public.spaces (name, slug) values ('Escritorio C', 'escritorio-c') $$,
  'SUPER_ADMIN cria espaço'
);
select lives_ok(
  $$ update public.spaces set status = 'suspended'
     where id = '10000000-0000-0000-0000-000000000002' $$,
  'SUPER_ADMIN suspende espaço'
);

-- ---- anônimo ----
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select is(
  (select count(*)::int from public.spaces),
  0,
  'Usuário anônimo não lê spaces'
);
select is(
  (select count(*)::int from public.profiles),
  0,
  'Usuário anônimo não lê profiles'
);

reset role;
select * from finish();
rollback;
