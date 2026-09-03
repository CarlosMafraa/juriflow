# JuriFlow

Plataforma **SaaS multi-tenant** para gestão e acompanhamento de **processos
jurídicos**, **clientes** e **movimentações processuais**, com **notificações
automatizadas por WhatsApp** e **trilha de auditoria** ponta a ponta.

O núcleo é um pipeline desacoplado:

```
Fonte Processual → Coletor → Normalizador → Processo/Estado → Histórico
→ Detector de Mudanças → Motor de Regras → Templates → WAHA → Auditoria
```

> **Estado atual: Fase 2 — Fundação.** Autenticação, multi-tenancy (`space_id`),
> papéis, RLS, layout autenticado, design system base e auditoria (estrutura).
> Módulos de negócio (processos, coletores DataJud/Projudi/scraping, detector de
> mudanças, notificações, WAHA completo, planos) entram nas fases seguintes.
> Plano completo: [`docs/PLANO-FASE-1.md`](docs/PLANO-FASE-1.md).

## Stack

| Camada                | Tecnologia                                                          |
| --------------------- | ------------------------------------------------------------------- |
| Frontend              | Angular 18 (standalone + signals), SPA, `@angular/cdk`              |
| Auth / Dados          | Supabase — Postgres 15, GoTrue, RLS, Storage                        |
| Regras puras          | `packages/domain` (TypeScript, sem I/O)                             |
| Arquitetura de coleta | `packages/collectors-core` (contratos — adapters nas fases futuras) |
| Testes                | Vitest (pacotes), Karma/Jasmine (Angular), pgTAP (RLS)              |
| Monorepo              | npm workspaces (ver [ADR-0002](docs/adr/0002-npm-workspaces.md))    |

## Estrutura do projeto

```
juriflow/
├─ apps/web/              # Angular 18 — frontend
│  └─ src/app/
│     ├─ core/            # config, supabase, auth, authorization, http, observability
│     ├─ shared/          # ui (design system), layout, feedback (toasts)
│     └─ features/        # auth, dashboard, placeholder, status
├─ packages/
│  ├─ shared-types/       # tipos/DTOs compartilhados
│  ├─ domain/             # autorização centralizada (RBAC) + catálogo de auditoria
│  └─ collectors-core/    # porta ProcessDataSource + SourceRegistry (sem adapters ainda)
├─ supabase/
│  ├─ migrations/         # SQL versionado — schema, RLS, funções, triggers
│  ├─ tests/              # pgTAP — isolamento por espaço, papéis, append-only
│  └─ seed.sql
├─ docs/
│  ├─ PLANO-FASE-1.md     # análise e planejamento completo
│  └─ adr/                # Architecture Decision Records
└─ .github/workflows/     # CI
```

## Pré-requisitos

- **Node.js ≥ 20.11** (ver [`.nvmrc`](.nvmrc)) e **npm ≥ 10**
- **Docker** (para o stack local do Supabase e para `supabase test db`)
- Navegador Chromium (Chrome ou Edge) para os testes do Angular

## Instalação

```bash
npm install
```

## Configuração de ambiente

Nenhum segredo é versionado. Copie o exemplo e ajuste:

```bash
cp .env.example .env
```

O frontend lê configuração pública de `apps/web/src/environments/`. Em produção,
`environment.production.ts` usa placeholders (`__WEB_SUPABASE_URL__` etc.)
substituídos pelo pipeline de deploy. **Nunca** colocar `service_role` key,
tokens ou credenciais no código ou em `environment*.ts`.

## Execução local

```bash
# 1. Sobe Postgres + Auth + Studio local e aplica as migrations
npm run db:start
npm run db:reset          # aplica migrations + seed do zero

# 2. Pegue as chaves locais e ajuste apps/web/src/environments/environment.ts se necessário
npx supabase status

# 3. Frontend
npm run dev               # http://localhost:4200
```

Para criar um usuário local: use o Studio (`http://127.0.0.1:54323`) → Authentication →
Add user, ou o signup do próprio app. O `profile` é criado automaticamente por
trigger. Para transformar em SUPER_ADMIN, no Studio SQL editor:
`update public.profiles set is_super_admin = true where email = '...';`

## Testes

```bash
npm test              # testes dos pacotes (Vitest): domínio (RBAC) + collectors-core
npm run test:web      # testes do Angular (Karma/Jasmine, headless)
npm run db:test       # testes de RLS (pgTAP) — requer db:start
```

Cobertura da fundação:

- **Autorização (`packages/domain`)** — matriz de papéis, `can()`, SUPER_ADMIN sem
  conteúdo operacional, falha fechada sem `spaceId`.
- **RLS (`supabase/tests`)** — usuário do Espaço A não lê o Espaço B; ADMIN só o
  próprio espaço; COLABORADOR sem privilégio administrativo; SUPER_ADMIN conforme
  RN7; `audit_logs` append-only; invariante "≥ 1 ADMIN ativo por espaço".
- **Angular** — guards (`authGuard`, `guestGuard`, `permissionGuard`),
  `PermissionService`, filtragem da navegação por permissão, layout responsivo
  (mobile/tablet/desktop).

## Migrations

SQL versionado em `supabase/migrations/` (prefixo `NNNN_`). Nunca alterar o banco
manualmente fora de uma migration.

```bash
npm run db:reset                       # recria o banco local do zero
npx supabase migration new <nome>      # cria um novo arquivo de migration
npm run db:diff                        # gera diff do schema atual
```

Fundação atual: `profiles`, `spaces`, `space_members` (+ enums, funções do schema
`app`, triggers) e `audit_logs` (append-only).

## Scripts

| Script                                                  | O que faz                                           |
| ------------------------------------------------------- | --------------------------------------------------- |
| `npm run build`                                         | `tsc -b` nos pacotes + build de produção do Angular |
| `npm run typecheck`                                     | Verificação de tipos dos pacotes                    |
| `npm run lint`                                          | ESLint (raiz + Angular)                             |
| `npm run format`                                        | Prettier (escrita)                                  |
| `npm test` / `npm run test:web` / `npm run db:test`     | Testes                                              |
| `npm run dev`                                           | `ng serve`                                          |
| `npm run db:start` / `db:stop` / `db:reset` / `db:test` | Supabase local                                      |

## Segurança (fundação)

Autorização em três camadas obrigatórias (ver
[ADR-0003](docs/adr/0003-autorizacao-centralizada.md)):

1. **RLS no Postgres** — verdade final; funções `SECURITY DEFINER` do schema `app`.
2. **Aplicação** — Edge Functions/RPC revalidam papel (fases futuras).
3. **UI** — guards e navegação apenas escondem; nunca é a única barreira.

Ocultar uma opção de menu **não** substitui autorização no backend.

## Documentação

- [`docs/PLANO-FASE-1.md`](docs/PLANO-FASE-1.md) — análise, arquitetura, modelo de
  dados, roadmap, decisões pendentes, riscos.
- [`docs/adr/`](docs/adr/) — decisões arquiteturais (stack, monorepo, RBAC, fontes
  de coleta, RLS, observabilidade).
