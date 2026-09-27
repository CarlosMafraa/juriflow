-- =============================================================================
-- 0045 — Permissões explícitas para o service_role (worker, bootstrap, função
-- de convite).
--
-- Desde 30/05/2026 a Supabase não concede mais, em projetos novos, acesso
-- automático às tabelas do schema public para anon/authenticated/service_role
-- (changelog "Tables not exposed to Data and GraphQL API automatically").
-- O `authenticated` já tinha GRANTs explícitos em cada migration; o
-- `service_role` dependia do automático — no projeto de produção, o worker e
-- o `npm run bootstrap:super-admin` recebiam "permission denied".
--
-- O service_role é só backend (ignora a RLS por definição); o `anon` continua
-- sem acesso a nenhuma tabela. Tabela nova daqui em diante: a própria
-- migration concede ao service_role (o default abaixo cobre o esquecimento, e
-- o teste pgTAP 0012 falha se faltar).
-- =============================================================================
grant usage on schema public to service_role;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;
