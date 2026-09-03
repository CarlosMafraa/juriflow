# ADR-0005 — RLS como fonte de verdade do isolamento por espaço

**Status:** Aceito · **Data:** 2026-09-02 · **Fase:** 2

## Contexto

Brief §5, §7, §12: isolamento por `space_id`, "não implemente isolamento somente
no frontend", "não confie em filtros enviados pelo frontend".

## Decisão

- Toda tabela operacional tem `space_id` e RLS `enable` + `force`.
- O recorte por espaço é feito **no banco**, via políticas que chamam
  `app.is_active_member(space_id)` / `app.is_space_admin(space_id)` /
  `app.is_super_admin()`.
- O frontend envia `space_id` apenas como conveniência de consulta; a política
  confere o vínculo real em `space_members` (status `active`).
- `SUPER_ADMIN`: acesso a metadados de `spaces`, a `space_members` e `profiles`
  (provisionamento — DP-35) e à auditoria; **nunca** a conteúdo operacional (RN7).
- `audit_logs` é **append-only** (gatilho bloqueia UPDATE/DELETE) e sem INSERT
  direto para usuários — escrita só por `app.write_audit_log` ou `service_role`.
- Invariante: um espaço nunca fica sem `ADMIN` ativo (gatilho
  `app.prevent_last_space_admin_loss`).

## Verificação

Suíte pgTAP obrigatória (`supabase/tests/`): tentativas cross-tenant devem
retornar 0 linhas / erro; `ADMIN` só o próprio espaço; `COLABORADOR` sem
privilégio administrativo; `SUPER_ADMIN` conforme RN7; append-only de
`audit_logs`. CI roda `supabase db reset` + `supabase test db`.

## Decisões pendentes relacionadas

- **DP-35** — `SUPER_ADMIN` enxergar/gerir `space_members` e `profiles`.
  Assumido SIM para provisionar (criar espaço + designar 1º ADMIN). Produto pode
  vetar; ajuste fica isolado nas políticas de 0004/0005.
- **DP-36** — self-signup de espaço. Assumido NÃO (só `SUPER_ADMIN` cria).
