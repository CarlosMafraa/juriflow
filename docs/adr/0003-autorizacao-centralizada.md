# ADR-0003 — Autorização centralizada e defesa em profundidade

**Status:** Aceito · **Data:** 2026-09-02 · **Fase:** 2

## Contexto

A documentação (brief, §4, §7, §12) exige que segurança **não dependa apenas da
interface** e que verificações de papel **não fiquem espalhadas** pelo código.

Papéis (DEFINIDO): `SUPER_ADMIN` (plataforma, global, sem conteúdo operacional —
RN7), `ADMIN` (todo o próprio espaço), `COLABORADOR` (só processos onde é
responsável atual — aplicável nas fases de negócio).

## Decisão

Autorização em **três camadas, todas obrigatórias**:

1. **RLS no Postgres** — verdade final. Toda tabela com `enable`/`force row level
security`. Políticas usam funções `SECURITY DEFINER` estáveis no schema `app`
   (`app.is_super_admin()`, `app.role_in_space()`, `app.is_space_admin()`,
   `app.is_active_member()`, `app.shares_space_with()`). Nenhuma checagem de papel
   duplicada em SQL fora dessas funções.
2. **Aplicação (Edge Functions / RPC — fases futuras)** — revalida papel e valida
   entrada antes de agir.
3. **UI (Angular)** — `PermissionService` + guards apenas **escondem/bloqueiam
   navegação**. Nunca é a única barreira.

O catálogo de permissões e a matriz papel→permissões ficam **exclusivamente** em
`packages/domain` (`PERMISSIONS`, `PERMISSION_MATRIX`, `can()`, `assertCan()`).
As funções SQL do schema `app` são o espelho desse modelo no banco. Ao adicionar
uma permissão: primeiro no `packages/domain`, depois na política/função SQL
correspondente, com teste dos dois lados.

## Modelo

- `SUPER_ADMIN` é atributo de plataforma (`profiles.is_super_admin`), **não** é
  linha em `space_members` (PP-01, assumido).
- `AuthSubject = { userId, isSuperAdmin, memberships[] }` — fatos mínimos, sem
  dados operacionais.
- Permissão com escopo de espaço **falha fechada** se `spaceId` não for informado.
- `SUPER_ADMIN` nunca recebe `space.manage`, `member.*` nem `audit.view` de
  espaço (RN7).

## Consequências

- Uma mudança de regra de acesso tem exatamente dois lugares: `packages/domain` e
  as migrations do schema `app`/políticas.
- Testes obrigatórios: unit em `packages/domain` + pgTAP de RLS.
