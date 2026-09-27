-- =============================================================================
-- Permissões dos papéis da API em TODA tabela do schema public (0045).
-- Projetos Supabase novos não concedem nada automaticamente: se uma tabela
-- nova esquecer o GRANT, este teste falha aqui, antes de produção.
-- Rode com: npm run db:test
-- =============================================================================
begin;
select * from no_plan();

-- service_role (worker, bootstrap, função de convite): acesso a todas.
select ok(
  has_table_privilege('service_role', format('public.%I', c.relname), 'SELECT, INSERT, UPDATE, DELETE'),
  format('service_role tem acesso a public.%s', c.relname)
)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

-- authenticated (app logado): toda tabela tem ao menos SELECT, exceto a
-- saúde do worker (só a plataforma, pela função platform_worker_status).
select ok(
  has_table_privilege('authenticated', format('public.%I', c.relname), 'SELECT'),
  format('authenticated lê public.%s (a RLS decide as linhas)', c.relname)
)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'worker_status'
order by c.relname;

select * from finish();
rollback;
