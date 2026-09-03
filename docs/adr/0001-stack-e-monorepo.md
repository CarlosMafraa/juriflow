# ADR-0001 — Stack e monorepo

**Status:** Aceito · **Data:** 2026-09-02 · **Fase:** 2

## Contexto

O JuriFlow precisa de frontend, banco/backend com RLS e, em fases futuras, Edge
Functions e workers de coleta. A Fase 1 propôs Supabase + Angular; o usuário
confirmou.

## Decisão

- **Frontend:** Angular 18 (standalone components, signals), SPA (sem SSR).
- **Backend/dados:** Supabase — Postgres 15, Auth (GoTrue), RLS, Storage e Edge
  Functions (Deno, fases futuras).
- **Monorepo** com workspaces, dividido em `apps/`, `packages/`, `supabase/` e
  (fases futuras) `services/`.
- Regras puras vivem em `packages/domain` (sem I/O), reutilizáveis pelo frontend
  e por futuros workers/functions.

## Consequências

- Histórico único e CI unificada.
- Mudança de contrato + migração de banco no mesmo PR.
- Deno/Edge Functions só entram quando a fase correspondente começar.
