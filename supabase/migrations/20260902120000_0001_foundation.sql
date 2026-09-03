-- =============================================================================
-- 0001 — Fundação: extensões, schema interno e utilitários compartilhados
-- =============================================================================

create extension if not exists "citext" with schema extensions;

-- Schema para funções internas de autorização/auditoria. NÃO é exposto pela API
-- (a config só expõe `public` e `graphql_public`), então essas funções não viram
-- endpoints REST.
create schema if not exists app;

revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- Trigger genérico de `updated_at`.
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.set_updated_at() is
  'Atualiza a coluna updated_at para now() em cada UPDATE.';
