-- =============================================================================
-- 0007 — Fase 3: extensões e enums (processos, clientes, tribunais)
-- =============================================================================

create extension if not exists "pg_trgm" with schema extensions;

create type public.process_status as enum ('active', 'archived', 'closed');
create type public.client_type as enum ('PF', 'PJ');
create type public.responsibility_reason as enum ('process_created', 'transfer');
create type public.court_type as enum (
  'STF', 'STJ', 'TST', 'TSE', 'STM', 'CNJ',
  'TRF', 'TJ', 'TRT', 'TRE', 'TJM', 'turma_recursal', 'outro'
);

comment on type public.process_status is 'active↔archived pelo criador/ADMIN; close/reabrir só ADMIN.';
