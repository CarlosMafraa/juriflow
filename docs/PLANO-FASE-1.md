# JuriFlow — Fase 1: Análise e Planejamento Técnico

> **Status:** Aprovado. A Fase 2 (Fundação) foi implementada — ver `README.md` e `docs/adr/`.
> **Data:** 2026-09-02
> **Fonte de verdade:** o brief funcional fornecido pelo usuário nesta conversa.
> A documentação funcional completa **não foi anexada**; tudo que não está explícito
> no brief está marcado como `INFERÊNCIA TÉCNICA` ou `DECISÃO PENDENTE`.

> **Adendos pós-aprovação:**
> - **Arquitetura de fontes (esclarecida pelo produto):** o acompanhamento usa
>   **múltiplos adapters** sob a porta `ProcessDataSource` — `DataJudAdapter`
>   (referência estrutural + consulta), `TribunalApiAdapter`, `TjamProjudiAdapter`
>   (consulta pública Projudi), `ScraperAdapter` (coletores específicos). Não é
>   "DataJud + scraping" como duas opções fixas; qualquer nova fonte se registra
>   sem tocar no núcleo. Detalhe em [`adr/0004-arquitetura-fontes-multi-adapter.md`](adr/0004-arquitetura-fontes-multi-adapter.md).
>   Nenhum coletor concreto foi implementado na Fase 2 — apenas os contratos.
> - **Gerenciador de pacotes:** npm workspaces em vez de pnpm+Nx (DP-18 resolvido) —
>   [`adr/0002-npm-workspaces.md`](adr/0002-npm-workspaces.md).
> - **Novas decisões pendentes** levantadas na Fase 2: **DP-35** (SUPER_ADMIN
>   enxergar/gerir `space_members` e `profiles` para provisionamento — assumido SIM),
>   **DP-36** (self-signup de espaço — assumido NÃO). Ver seção 17 e
>   [`adr/0005-rls-isolamento.md`](adr/0005-rls-isolamento.md).

---

## Convenções de classificação

| Marca | Significado |
|---|---|
| `DEFINIDO` | Explícito no brief. É regra de produto e não será alterado sem autorização. |
| `INFERÊNCIA TÉCNICA` | Decisão de engenharia que **não altera** comportamento, preço, permissão, fluxo ou UX. Tomada e documentada aqui. |
| `DECISÃO PENDENTE` | Depende de decisão de produto porque altera comportamento, preço, permissão, fluxo, regra de negócio ou experiência. Não foi decidida. |

Toda `DECISÃO PENDENTE` recebe um ID (`DP-01`, `DP-02`, ...) e está consolidada na seção 15.
Todo risco recebe `RT-01`, `RT-02`, ... na seção 16.
Toda pergunta de produto recebe `PP-01`, `PP-02`, ... na seção 17.

---

## 1. Resumo executivo

O **JuriFlow** é uma plataforma **SaaS multi-tenant** para escritórios de advocacia. Ele
centraliza o cadastro de **processos jurídicos**, **clientes** e **tribunais**, coleta
**movimentações processuais** de fontes externas, **detecta mudanças** relevantes e dispara
**notificações automatizadas por WhatsApp** para advogados/responsáveis e clientes, com
**trilha de auditoria** de ponta a ponta.

O coração do sistema é um **pipeline desacoplado**:

```
Fonte Processual → Coletor → Normalizador → Processo/Estado → Histórico de Movimentações
→ Detector de Mudanças → Motor de Regras → Templates → WAHA → Auditoria
```

O requisito arquitetural central (`DEFINIDO`) é que **adicionar um novo tribunal ou uma
nova estratégia de coleta não pode exigir alteração no núcleo de regras de negócio**. Isso
se resolve com **Ports & Adapters (arquitetura hexagonal)**: cada fonte é um adapter que
entrega dados num formato canônico; o núcleo (detecção de mudança, motor de regras,
notificação, auditoria) não conhece tribunal nenhum.

**Multi-tenancy** é por `space_id`, com isolamento imposto **no banco via RLS** (não apenas
na API e nunca só na UI). Três perfis (`DEFINIDO`):

- **SUPER_ADMIN** — opera globalmente (gestão de espaços, planos, tribunais, catálogo), **sem
  acesso ao conteúdo operacional** dos espaços (processos, clientes, movimentações, mensagens).
- **ADMIN** — enxerga e administra **todos os dados operacionais do próprio espaço**; único
  que transfere processos e administra a integração WhatsApp.
- **COLABORADOR** — enxerga **somente os processos cujo responsável atual seja ele próprio**;
  sem acesso a sessão WhatsApp, QR Code ou credenciais.

**Stack decidida pelo usuário:** **Supabase** (Postgres + Auth + RLS + Storage + Edge
Functions) no backend/dados e **Angular** no frontend. A **orquestração/hospedagem do WAHA**
e o **runtime dos coletores/jobs pesados** ficam como `DECISÃO PENDENTE` (`DP-01`, `DP-02`) —
Supabase não hospeda contêineres de longa duração nem navegador headless, o que impacta a
coleta do TJAM/Projudi.

**O que este documento entrega:** análise da documentação, análise do repositório (vazio),
arquitetura proposta, estrutura de projeto, modelo de dados das 14 entidades, fluxos
principais, matriz de permissões, estratégias de integração/jobs/segurança/testes, roadmap
em 16 fases, critérios de aceite verificáveis, e as listas consolidadas de decisões
pendentes, riscos técnicos e perguntas de produto.

---

## 2. Análise da documentação (o brief)

### 2.1 Funcionalidades

| # | Funcionalidade | Classificação | Observação |
|---|---|---|---|
| F1 | Cadastro e gestão de processos jurídicos | `DEFINIDO` | Fluxo detalhado na seção 6 do brief |
| F2 | Cadastro e gestão de clientes | `DEFINIDO` | Cliente é **opcional** no processo |
| F3 | Vínculo processo ↔ cliente (N:N) | `DEFINIDO` | Entidade `process_clients` |
| F4 | Catálogo de tribunais e aliases | `DEFINIDO` | `courts`, `court_aliases`; DataJud como referência estrutural |
| F5 | Configuração de acompanhamento por processo | `DEFINIDO` | `process_tracking_configs` |
| F6 | Coleta de movimentações de fontes externas | `DEFINIDO` | Múltiplas fontes; DataJud + TJAM/Projudi |
| F7 | Histórico de movimentações | `DEFINIDO` | `process_movements` |
| F8 | Detecção de mudanças relevantes | `DEFINIDO` (mecanismo) / critério de "relevante" `DECISÃO PENDENTE` (`DP-03`) | Seção 8 do brief |
| F9 | Regras de notificação independentes (responsável e cliente) | `DEFINIDO` | `notification_rules` |
| F10 | Templates de mensagem | `DEFINIDO` | `message_templates`; conteúdo/variáveis `DECISÃO PENDENTE` (`DP-04`) |
| F11 | Entrega de notificações via WhatsApp | `DEFINIDO` | `notification_deliveries` + WAHA |
| F12 | Gestão da sessão WhatsApp por espaço (conectar, QR, status, reconectar) | `DEFINIDO` | Somente ADMIN |
| F13 | Notificação de aniversário de clientes | `DEFINIDO` | Job dedicado; canal/horário/template `DECISÃO PENDENTE` (`DP-05`) |
| F14 | Transferência de responsabilidade de processo | `DEFINIDO` | Somente ADMIN; preserva histórico |
| F15 | Dashboard | `DEFINIDO` (existe) / conteúdo `DECISÃO PENDENTE` (`DP-06`) | Métricas não especificadas |
| F16 | Trilha de auditoria | `DEFINIDO` | `audit_logs`; escopo exato `DECISÃO PENDENTE` (`DP-07`) |
| F17 | Administração global (espaços, planos, catálogo) | `DEFINIDO` | Perfil SUPER_ADMIN |
| F18 | Planos e limites de uso | `INFERÊNCIA TÉCNICA` (existe pela fase 14 do roadmap-exemplo) / regras `DECISÃO PENDENTE` (`DP-08`) | Brief cita "Planos e limites" mas não define nenhum limite |
| F19 | Gestão de usuários do espaço (convite, papéis) | `INFERÊNCIA TÉCNICA` | Brief cita tela "usuários" e `space_members`; fluxo de convite não especificado (`DP-09`) |
| F20 | Autenticação (login) | `DEFINIDO` | Tela de login prevista |

### 2.2 Módulos

`INFERÊNCIA TÉCNICA` — agrupamento derivado das funcionalidades e telas do brief:

1. **Auth & Identidade** — login, sessão, recuperação de senha.
2. **Multi-tenancy & Membros** — `spaces`, `profiles`, `space_members`, troca de espaço ativo.
3. **Processos** — CRUD, responsável, transferência, vínculo com clientes/tribunal.
4. **Clientes** — CRUD, dados de contato, aniversário.
5. **Tribunais & Catálogo** — `courts`, `court_aliases`, importação DataJud.
6. **Acompanhamento (Tracking)** — `process_tracking_configs`, agendamento, estado da coleta.
7. **Coleta (Collector)** — adapters de fonte, orquestração, rate limit por fonte.
8. **Normalização** — mapeamento de payloads de fonte para movimentação canônica.
9. **Movimentações & Estado** — `process_movements`, snapshot de estado do processo.
10. **Detector de Mudanças** — diff, deduplicação, idempotência, primeira coleta.
11. **Motor de Regras** — avalia `notification_rules` contra eventos.
12. **Templates & Renderização** — `message_templates`, substituição de variáveis.
13. **Notificações & Delivery** — `notification_deliveries`, retry, status.
14. **WAHA Gateway** — sessão por espaço, QR, status, envio, webhooks.
15. **Jobs & Scheduler** — rotina 08:00, aniversários, retries, monitoração.
16. **Auditoria** — `audit_logs`, consulta.
17. **Administração Global** — espaços, planos, catálogo (SUPER_ADMIN).
18. **Dashboard & Relatórios**.

### 2.3 Entidades

As 14 entidades são `DEFINIDO` (nomes vindos do brief). Modelo detalhado na seção 5.

```
spaces · profiles · space_members · processes · process_movements · clients
process_clients · courts · court_aliases · process_tracking_configs
notification_rules · message_templates · notification_deliveries · audit_logs
```

### 2.4 Regras de negócio explícitas

| ID | Regra | Classificação |
|---|---|---|
| RN1 | `responsible_id` = responsável **atual** do processo | `DEFINIDO` |
| RN2 | `created_by` = quem **criou** o processo (imutável) | `DEFINIDO` |
| RN3 | Transferência de responsabilidade **preserva histórico** | `DEFINIDO` |
| RN4 | **Somente ADMIN** transfere processos | `DEFINIDO` |
| RN5 | COLABORADOR vê **somente** processos onde é o responsável **atual** | `DEFINIDO` |
| RN6 | ADMIN vê os **dados operacionais do próprio espaço** | `DEFINIDO` |
| RN7 | SUPER_ADMIN atua **globalmente**, mas **não acessa conteúdo operacional** dos espaços | `DEFINIDO` |
| RN8 | Cliente no processo é **opcional** | `DEFINIDO` |
| RN9 | DataJud é **referência estrutural** (tribunais, categorias, aliases), **não** fonte única de movimentações | `DEFINIDO` |
| RN10 | TJAM/Projudi tem **estratégia isolada** de integração/coleta; o sistema **não** pode ser acoplado ao scraping do TJAM | `DEFINIDO` |
| RN11 | Primeira coleta é **registrada** mas **não necessariamente** tratada como mudança histórica/notificável | `DEFINIDO` (intenção) / detalhe operacional em `DP-03` |
| RN12 | Falha no WhatsApp **não pode alterar incorretamente** o estado do processo | `DEFINIDO` |
| RN13 | Regras de notificação **independentes** para responsável e para cliente | `DEFINIDO` |
| RN14 | **Somente ADMIN** administra a integração WhatsApp | `DEFINIDO` |
| RN15 | COLABORADOR **não** acessa sessão, QR Code ou credenciais WhatsApp | `DEFINIDO` |
| RN16 | Notificações **idempotentes**, com **retry** e **status de entrega** | `DEFINIDO` (requisito) / parâmetros em `DP-10` |
| RN17 | Rotina inicial de acompanhamento: **08:00 diariamente** | `DEFINIDO` (inicial, não definitivo) |
| RN18 | Segurança **não pode depender apenas da interface** | `DEFINIDO` |
| RN19 | WAHA é **camada de transporte** apenas | `DEFINIDO` |

### 2.5 Perfis de usuário

`DEFINIDO`: `SUPER_ADMIN`, `ADMIN`, `COLABORADOR`. Detalhe de escopo na seção 8 (matriz de permissões).

`DECISÃO PENDENTE` (`DP-11`): um usuário pode pertencer a **mais de um espaço** e com **papéis
diferentes** em cada um? A presença de `space_members` como tabela associativa sugere que sim
(`INFERÊNCIA TÉCNICA`), mas isso muda UX (seletor de espaço) e modelo de sessão.

### 2.6 Permissões

`DEFINIDO` em nível de princípio (seções 4, 6, 10 do brief). Matriz operacional completa na
seção 8 — as células não cobertas pelo brief estão marcadas `DECISÃO PENDENTE`.

### 2.7 Integrações

| Integração | Papel | Classificação |
|---|---|---|
| **DataJud (CNJ)** | Referência estrutural de tribunais/categorias/aliases; possível fonte de movimentações | `DEFINIDO` (papel estrutural) / uso como fonte de movimentações `DECISÃO PENDENTE` (`DP-12`) |
| **TJAM / Projudi** | Fonte de movimentações via estratégia isolada (provável scraping/sessão autenticada) | `DEFINIDO` (que existe e é isolada) / mecanismo (API? scraping? credenciais de quem?) `DECISÃO PENDENTE` (`DP-13`) |
| **WAHA** | Transporte de mensagens WhatsApp; sessão por espaço | `DEFINIDO` (papel) / hospedagem e topologia `DECISÃO PENDENTE` (`DP-01`) |

### 2.8 Automações / Jobs

`DEFINIDO` que existem: atualização processual, processamento de movimentações, detecção de
mudanças, notificações, aniversário de clientes, retries, monitoramento das execuções.
`DEFINIDO`: rotina inicial às **08:00** diárias (marcada como não-definitiva).
`DECISÃO PENDENTE` (`DP-14`): fuso horário de referência, janelas de execução, política de
concorrência entre espaços, e se a coleta é *pull* agendado, *event-driven*, ou híbrido.

### 2.9 Requisitos de segurança

`DEFINIDO` (lista do brief, seção 12): autenticação; autorização; RLS; isolamento por
`space_id`; gestão de secrets/tokens/credenciais WAHA/APIs externas; não exposição de dados
no frontend; auditoria; rate limiting; validação de entrada; proteção contra acesso indevido
entre espaços. `DEFINIDO` (RN18): segurança não pode depender apenas da UI.
Parâmetros concretos (limites de rate, política de senha, MFA, rotação de secrets) são
`DECISÃO PENDENTE` (`DP-15`).

### 2.10 Requisitos de auditoria

`DEFINIDO`: existe `audit_logs`; auditoria de ponta a ponta do pipeline; execuções de jobs
monitoradas; status/falhas de delivery registrados.
`DECISÃO PENDENTE` (`DP-07`): quais ações exatamente são auditadas, retenção, quem pode ler,
se há exportação e se leituras de dados sensíveis também são auditadas.

### 2.11 Responsividade

`DEFINIDO` (breakpoints):

```
Mobile   < 768px
Tablet   768–1023px
Desktop  ≥ 1024px
```

`DECISÃO PENDENTE` (`DP-16`): quais telas são *mobile-first* obrigatórias vs. "desktop com
degradação graciosa". Suspeita técnica: operação diária (processos, movimentações,
notificações) precisa funcionar bem no mobile; administração global pode ser desktop-first.

### 2.12 Requisitos de infraestrutura

`DEFINIDO` (por escolha de stack): Supabase gerenciado. `INFERÊNCIA TÉCNICA`: ambientes
`local` / `staging` / `production`; migrations versionadas; IaC do que estiver fora do
Supabase. `DECISÃO PENDENTE` (`DP-01`, `DP-02`): onde rodam WAHA e workers de coleta pesada.

### 2.13 Requisitos de banco de dados

`DEFINIDO`: Postgres (via Supabase); RLS obrigatório; isolamento por `space_id`; 14 entidades
nomeadas; auditoria. `INFERÊNCIA TÉCNICA`: UUID v4 como PK; `created_at`/`updated_at` em toda
tabela; *soft delete* onde houver referência histórica; `citext`/normalização para aliases;
FKs com `on delete` explícito.

### 2.14 Requisitos de frontend

`DEFINIDO`: Angular; telas listadas na seção 13 do brief; breakpoints da seção 2.11;
segurança não pode depender da UI (a UI **esconde**, o backend **impede**).
`INFERÊNCIA TÉCNICA`: SPA (sem SSR); Angular 17+ standalone + signals; `@angular/cdk/layout`
para breakpoints; `supabase-js` no cliente; route guards por papel; interceptors para
`space_id` e erros. Biblioteca de componentes é `DECISÃO PENDENTE` (`DP-17`).

### 2.15 Requisitos de backend

`DEFINIDO`: Supabase (Postgres + Auth + RLS + Edge Functions). `INFERÊNCIA TÉCNICA`: lógica
de escrita sensível (transferência de processo, avaliação de regras, envio) em **Edge
Functions/RPC `SECURITY DEFINER` com checagem explícita de papel**, nunca só client-side;
webhooks do WAHA recebidos por Edge Function. Runtime de coleta pesada em `DP-02`.

### 2.16 Lacunas da documentação (resumo)

O brief define **arquitetura, entidades, perfis e princípios**, mas **não define**: critério
de "mudança relevante"; conteúdo/variáveis de templates; regras de planos/limites; fluxo de
convite de usuários; parâmetros de retry/rate limit; escopo fino de auditoria; mecânica exata
da coleta TJAM/Projudi; hospedagem do WAHA; conteúdo do dashboard; fuso/janelas de job.
Todas viram `DECISÃO PENDENTE` (seção 15).

---

## 3. Análise do repositório

**Estado atual — repositório essencialmente vazio.**

| Item | Situação |
|---|---|
| Arquivos versionados | Apenas `README.md` (10 bytes, conteúdo: `# juriflow`) |
| Commits | 1 (`813f17b Initial commit`) |
| Branch | `master` |
| `package.json` / lockfile | ❌ inexistente |
| Package manager | ❌ não definido |
| Dependências | ❌ nenhuma |
| Configuração de ambiente (`.env`, `.env.example`) | ❌ inexistente |
| Docker / `docker-compose` | ❌ inexistente |
| Banco / migrations | ❌ inexistente |
| Autenticação | ❌ inexistente |
| Frontend | ❌ inexistente |
| Backend | ❌ inexistente |
| Testes | ❌ inexistente |
| CI/CD (`.github/workflows`, etc.) | ❌ inexistente |
| Arquivos de config (lint, tsconfig, editorconfig) | ❌ inexistente |
| Documentação | Apenas o título no `README.md`; este documento em `docs/` |

**Conclusão:** não há nada a preservar além do `README.md` (que será **expandido**, não
substituído) e do histórico git. Nenhum arquivo existente será apagado. Toda a estrutura é
*greenfield* — proposta na seção 4.

---

## 4. Estrutura do projeto proposta

`INFERÊNCIA TÉCNICA`. **Monorepo** gerenciado com **pnpm workspaces** + **Nx** (opcional, ver
`DP-18`). Justificativa: frontend Angular, Edge Functions Deno, worker(s) Node e pacotes de
tipos/contratos compartilhados convivem melhor com um único histórico, versionamento atômico
de mudança de contrato + migração, e CI unificada.

```
juriflow/
├─ README.md                         # expandido (não substituído)
├─ package.json                      # workspace root (pnpm)
├─ pnpm-workspace.yaml
├─ nx.json / turbo.json              # DP-18 (orquestração de tarefas)
├─ .editorconfig .gitignore .nvmrc
├─ .env.example                      # todas as variáveis, sem valores
├─ docs/
│  ├─ PLANO-FASE-1.md                # este documento
│  ├─ adr/                           # Architecture Decision Records
│  └─ runbooks/                      # operação: WAHA caiu, job travou, etc.
│
├─ apps/
│  └─ web/                           # Angular 17+ (standalone, signals)
│     ├─ src/app/core/               # auth, guards, interceptors, supabase client
│     ├─ src/app/shared/             # componentes, pipes, diretivas, layout responsivo
│     ├─ src/app/features/
│     │  ├─ auth/  dashboard/  processes/  process-detail/  movements/
│     │  ├─ clients/  courts/  settings/  notification-rules/  templates/
│     │  ├─ whatsapp/  users/  audit/  admin/
│     └─ src/environments/
│
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/                    # SQL versionado (schema, RLS, policies, funcs)
│  ├─ seed/                          # catálogo base (tribunais DataJud, etc.)
│  └─ functions/                     # Edge Functions (Deno)
│     ├─ waha-webhook/               # recebe eventos de entrega/sessão
│     ├─ process-transfer/           # RPC sensível (somente ADMIN)
│     ├─ rules-eval/                 # motor de regras (invocável e por job)
│     ├─ notification-dispatch/      # renderiza template + chama WAHA gateway
│     └─ _shared/                    # libs comuns às functions
│
├─ services/
│  └─ collector-worker/             # DP-02 — runtime de coleta pesada / scraping TJAM
│     ├─ src/adapters/              # datajud/  tjam-projudi/  (novos tribunais aqui)
│     ├─ src/core/                  # orquestração, normalização, agendamento
│     └─ src/waha/                  # cliente WAHA (envio), se envio ficar no worker
│
├─ packages/
│  ├─ shared-types/                 # tipos TS gerados do schema + DTOs canônicos
│  ├─ domain/                       # regras puras: detector de mudanças, motor de regras
│  │                               #   (sem I/O — testável isoladamente)
│  ├─ movement-normalizer/          # payload de fonte → Movimentação Canônica
│  └─ config/                       # tsconfig base, eslint, prettier compartilhados
│
├─ infra/                           # IaC do que estiver fora do Supabase (WAHA, worker)
│  └─ (docker/ , fly.toml , railway.json , terraform/ ... conforme DP-01/DP-02)
│
└─ .github/workflows/               # CI: lint, typecheck, test, migrations dry-run, deploy
```

**Princípio de camadas:** `packages/domain` e `packages/movement-normalizer` são **puros**
(sem rede, sem banco). Adapters (`services/collector-worker/src/adapters/*`) implementam uma
*port* (`SourceAdapter`) e são a **única** parte que sabe o que é "TJAM" ou "DataJud". Isso
cumpre o requisito `DEFINIDO` de adicionar tribunal/estratégia sem tocar o núcleo.

---

## 5. Modelo de dados

`INFERÊNCIA TÉCNICA` salvo onde marcado. **Nada será implementado no banco antes da aprovação
deste modelo.** Convenções globais:

- PK: `id uuid default gen_random_uuid()`.
- Toda tabela operacional tem `space_id uuid not null references spaces(id)` — **exceto**
  `spaces`, `profiles` e o catálogo global (`courts`, `court_aliases`) — ver isolamento abaixo.
- `created_at timestamptz not null default now()`, `updated_at timestamptz` (trigger).
- *Soft delete* (`deleted_at timestamptz`) onde há histórico/auditoria dependente.
- RLS **habilitada em todas as tabelas**; políticas descritas por entidade.
- Função auxiliar `auth_space_role(space_id)` → papel do usuário no espaço (usada nas policies).

### 5.1 `spaces`

- **Finalidade:** o tenant. Um escritório/organização.
- **Campos:** `id`, `name`, `slug` (único), `plan_id` (`DP-08`), `status` (`active`/`suspended`), `created_by` (profile do SUPER_ADMIN ou signup), `settings jsonb`, timestamps.
- **Relacionamentos:** 1:N com quase tudo; N:M com `profiles` via `space_members`.
- **Chaves/índices:** PK `id`; único `slug`; índice `status`.
- **Constraints:** `name` not null; `status` enum.
- **Isolamento:** legível por membros do próprio espaço e por SUPER_ADMIN; **conteúdo operacional não**, mas os metadados do espaço sim.
- **Auditoria:** criação, suspensão, mudança de plano.
- **Riscos:** `RT-01` (definição de "SUPER_ADMIN não acessa conteúdo operacional" precisa ser cirúrgica nas policies).

### 5.2 `profiles`

- **Finalidade:** dados do usuário, 1:1 com `auth.users` do Supabase.
- **Campos:** `id` (= `auth.users.id`), `full_name`, `email` (espelho), `phone` (`DP-19` — formato E.164), `is_super_admin boolean default false`, `avatar_url`, timestamps.
- **Relacionamentos:** N:M com `spaces` via `space_members`; referenciado por `processes.responsible_id`, `processes.created_by`, `audit_logs.actor_id`.
- **Chaves/índices:** PK `id`; único `email`.
- **Constraints:** FK para `auth.users(id) on delete cascade`.
- **Isolamento:** o próprio usuário lê/edita seu perfil; membros de um mesmo espaço leem nome/telefone de colegas (necessário para atribuir responsável); SUPER_ADMIN lê todos.
- **Auditoria:** promoção/rebaixamento a SUPER_ADMIN (`is_super_admin`), mudança de telefone.
- **Riscos:** `RT-02` — `is_super_admin` como coluna booleana é um alvo sensível; toda policy que confere super admin deve usar função `SECURITY DEFINER` estável, não subselect editável.

### 5.3 `space_members`

- **Finalidade:** vínculo usuário↔espaço com papel.
- **Campos:** `id`, `space_id`, `profile_id`, `role` enum (`ADMIN`/`COLABORADOR`), `status` (`active`/`invited`/`disabled`), `invited_by`, `invited_at`, `accepted_at`, timestamps.
- **Relacionamentos:** N:1 `spaces`, N:1 `profiles`.
- **Chaves/índices:** único `(space_id, profile_id)`; índice `(space_id, role)`; índice `(space_id, status)`.
- **Constraints:** `role` não inclui `SUPER_ADMIN` (super admin é global, via `profiles.is_super_admin`) — `INFERÊNCIA TÉCNICA`; confirmar em `PP-01`.
- **Isolamento:** ADMIN do espaço lê/gerencia membros do espaço; COLABORADOR lê a lista (para ver quem é quem) mas não gerencia — `DP-09`; SUPER_ADMIN lê todos.
- **Auditoria:** convite, aceite, mudança de papel, desativação.
- **Riscos:** `RT-03` — rebaixar o único ADMIN de um espaço deixaria o espaço sem administrador; precisa de constraint/trigger "ao menos 1 ADMIN ativo" (`DP-09`).

### 5.4 `processes`

- **Finalidade:** o processo jurídico acompanhado.
- **Campos:** `id`, `space_id`, `cnj_number` (número único CNJ, normalizado), `internal_ref` (`DP-20`), `title`/`subject`, `court_id`, `instance`/`degree` (`DP-21`), `responsible_id` (**responsável atual**, RN1), `created_by` (**imutável**, RN2), `status` (`active`/`archived`/`closed` — `DP-22`), `tracking_enabled boolean`, `last_synced_at`, `state_hash` (hash do último estado normalizado — ver seção 8), timestamps, `deleted_at`.
- **Relacionamentos:** N:1 `spaces`, `courts`, `profiles` (2x); 1:N `process_movements`; N:M `clients` via `process_clients`; 1:1/1:N `process_tracking_configs` (`DP-23` — um processo pode ter mais de uma config de fonte?).
- **Chaves/índices:** único `(space_id, cnj_number)`; índice `(space_id, responsible_id)` (crítico para RLS do COLABORADOR); índice `(space_id, status)`; índice `(tracking_enabled, last_synced_at)` para o job.
- **Constraints:** `cnj_number` valida máscara CNJ (`INFERÊNCIA TÉCNICA`); `created_by` protegido por trigger contra UPDATE.
- **Isolamento (RLS):**
  - COLABORADOR: `space_id = X AND responsible_id = auth.uid()` (RN5).
  - ADMIN: `space_id = X` (RN6).
  - SUPER_ADMIN: **sem acesso** ao conteúdo (RN7) — nenhuma policy concede SELECT a super admin aqui.
- **Auditoria:** criação, edição de campos-chave, transferência de responsável (RN3/RN4), arquivamento, ativação/desativação de tracking.
- **Riscos:** `RT-04` — se o COLABORADOR perde acesso ao ser transferido o processo, ele também perde acesso às **movimentações passadas** que talvez precise consultar; produto precisa decidir (`PP-02`). `RT-05` — número CNJ pode não existir (processo físico/sigiloso); permitir processo sem CNJ? (`DP-24`).

### 5.5 `process_movements`

- **Finalidade:** histórico imutável de movimentações processuais (uma linha por movimentação coletada).
- **Campos:** `id`, `space_id`, `process_id`, `source` enum (`datajud`/`tjam_projudi`/...), `source_movement_id` (id da movimentação na fonte, quando houver), `occurred_at` (data da movimentação na fonte), `collected_at`, `category_code`/`category_label` (taxonomia — DataJud como referência, RN9), `description` (texto), `raw jsonb` (payload original da fonte), `content_hash` (hash normalizado para dedupe — seção 8), `is_first_sync boolean` (RN11), timestamps.
- **Relacionamentos:** N:1 `processes`, N:1 `spaces`.
- **Chaves/índices:** único `(process_id, source, content_hash)` (idempotência de coleta); índice `(process_id, occurred_at desc)`; índice `(space_id, collected_at)`.
- **Constraints:** linha **append-only** (sem UPDATE/DELETE via trigger, exceto correção administrativa auditada); `raw` obrigatório.
- **Isolamento:** herda o acesso do `process_id` (mesmas regras da 5.4). COLABORADOR só vê movimentações de processos onde é responsável atual — ver `RT-04`.
- **Auditoria:** a própria tabela é o registro; correções manuais são auditadas em `audit_logs`.
- **Riscos:** `RT-06` — fontes diferentes podem reportar a "mesma" movimentação com textos distintos; o `content_hash` precisa de regra de normalização estável (`DP-03`). `RT-07` — volume: processos antigos podem ter centenas de movimentações; paginação e índice desde o início.

### 5.6 `clients`

- **Finalidade:** cliente do escritório (pessoa física ou jurídica).
- **Campos:** `id`, `space_id`, `type` (`PF`/`PJ`), `name`, `document` (CPF/CNPJ normalizado, `DP-25` sobre obrigatoriedade), `email`, `phone` (E.164), `birth_date` (para F13; nulo para PJ), `notes`, `notification_opt_in boolean` (`DP-26` — consentimento para receber WhatsApp), timestamps, `deleted_at`.
- **Relacionamentos:** N:M `processes` via `process_clients`.
- **Chaves/índices:** único `(space_id, document)` quando `document` não nulo; índice `(space_id, birth_date)` para o job de aniversário; índice trigram em `name` para busca.
- **Constraints:** `type` enum; `birth_date` só PF.
- **Isolamento:** ADMIN vê todos os clientes do espaço; COLABORADOR vê **clientes vinculados a processos onde é responsável atual** (`INFERÊNCIA TÉCNICA` — o brief só define visibilidade de processos; confirmar em `PP-03`). SUPER_ADMIN: sem acesso.
- **Auditoria:** criação, edição de contato, mudança de opt-in.
- **Riscos:** `RT-08` — LGPD: dados pessoais de terceiros (clientes) exigem base legal, opt-in explícito para WhatsApp e possibilidade de exclusão/anonimização (`PP-04`).

### 5.7 `process_clients`

- **Finalidade:** associação N:M processo↔cliente, com papel do cliente no processo.
- **Campos:** `id`, `space_id`, `process_id`, `client_id`, `role` (`autor`/`réu`/`interessado`/... — `DP-27`), `is_primary boolean`, timestamps.
- **Chaves/índices:** único `(process_id, client_id)`; índice `(client_id)`.
- **Constraints:** `space_id` deve coincidir com o de `process` e `client` (trigger).
- **Isolamento:** herda de `process_id`.
- **Auditoria:** vínculo/desvínculo.
- **Riscos:** `RT-09` — divergência de `space_id` entre as três tabelas se não houver trigger.

### 5.8 `courts`

- **Finalidade:** catálogo **global** de tribunais/varas/órgãos (referência estrutural DataJud, RN9).
- **Campos:** `id`, `datajud_code`, `name`, `type` (`TJ`/`TRF`/`TRT`/`STJ`/...), `jurisdiction` (UF/federal), `parent_court_id` (hierarquia vara→comarca→tribunal), `tracking_strategy` (`datajud`/`tjam_projudi`/`none` — `DP-28`), `active boolean`, timestamps.
- **Relacionamentos:** auto-referência `parent_court_id`; 1:N `court_aliases`; 1:N `processes`.
- **Chaves/índices:** único `datajud_code` quando presente; índice `(type, jurisdiction)`.
- **Constraints:** `type` enum.
- **Isolamento:** **catálogo global** — leitura por qualquer usuário autenticado; escrita **somente SUPER_ADMIN** (`INFERÊNCIA TÉCNICA`; confirmar `PP-05` — ou ADMIN pode cadastrar tribunal local?).
- **Auditoria:** criação/edição por SUPER_ADMIN; importação DataJud (job).
- **Riscos:** `RT-10` — se ADMIN não pode criar tribunal e o catálogo está incompleto, cadastro de processo trava. Mitigação: importação DataJud abrangente + fila de "tribunal solicitado".

### 5.9 `court_aliases`

- **Finalidade:** nomes alternativos/variações de grafia de um tribunal, para casar texto vindo de fontes (RN9).
- **Campos:** `id`, `court_id`, `alias` (`citext`), `source` (`datajud`/`manual`/`tjam`), `confidence` (`DP-29`), timestamps.
- **Chaves/índices:** único `(court_id, alias)`; índice `alias` (busca).
- **Constraints:** `alias` not null.
- **Isolamento:** leitura global autenticada; escrita SUPER_ADMIN + jobs.
- **Auditoria:** criação manual.
- **Riscos:** `RT-11` — alias ambíguo apontando para tribunais diferentes; `confidence` + revisão manual.

### 5.10 `process_tracking_configs`

- **Finalidade:** como e com que frequência um processo é acompanhado, e em qual fonte.
- **Campos:** `id`, `space_id`, `process_id`, `source` enum, `enabled boolean`, `frequency` (`daily`/... — `DP-14`), `schedule_time` (default `08:00`, RN17), `source_params jsonb` (ex.: credenciais/sessão TJAM por processo? — `DP-13`), `last_run_at`, `last_run_status`, `next_run_at`, `failure_count`, timestamps.
- **Relacionamentos:** N:1 `processes` (`DP-23` — 1 ou N configs por processo).
- **Chaves/índices:** único `(process_id, source)`; índice `(enabled, next_run_at)` (o scheduler varre isso).
- **Constraints:** `source` enum; `schedule_time` timezone-aware (`DP-14`).
- **Isolamento:** herda de `process_id`; COLABORADOR pode **editar** a config de acompanhamento do próprio processo? (`PP-06`) — `INFERÊNCIA`: pode ligar/desligar, não pode mudar fonte.
- **Auditoria:** habilitar/desabilitar, mudança de frequência/fonte.
- **Riscos:** `RT-12` — `source_params` com credenciais **não pode** ficar em `jsonb` claro; se houver segredo por processo, usar Supabase Vault / referência a secret (`DP-13`).

### 5.11 `notification_rules`

- **Finalidade:** regra que, dado um evento (movimentação nova / mudança detectada), define **quem** é notificado, **com qual template** e **em qual canal**.
- **Campos:** `id`, `space_id`, `name`, `scope` enum (`space`/`process`), `process_id` (nulo se `scope=space`), `audience` enum (`responsible`/`client` — RN13), `event_type` enum (`new_movement`/`status_change`/`first_sync`/... — `DP-03`), `filter jsonb` (ex.: só certas categorias — `DP-30`), `template_id`, `channel` (`whatsapp` — único hoje), `enabled boolean`, `priority int`, timestamps.
- **Relacionamentos:** N:1 `message_templates`; N:1 `processes` (opcional); N:1 `spaces`.
- **Chaves/índices:** índice `(space_id, enabled, event_type)`; índice `(process_id)`.
- **Constraints:** `audience` + `event_type` obrigatórios; `process_id` not null ⇔ `scope=process`.
- **Isolamento:** ADMIN cria/edita regras do espaço; COLABORADOR **lê** as que afetam seus processos (`PP-07`), não edita. SUPER_ADMIN: sem acesso.
- **Auditoria:** criação/edição/ativação de regra (impacta quem recebe mensagem — sensível).
- **Riscos:** `RT-13` — regras sobrepostas geram mensagens duplicadas ao mesmo destinatário; precisa de deduplicação no dispatch (seção 9) e/ou resolução por `priority`.

### 5.12 `message_templates`

- **Finalidade:** texto parametrizável da mensagem.
- **Campos:** `id`, `space_id` (nulo = template global do sistema? `DP-31`), `name`, `channel`, `audience`, `body` (com placeholders `{{...}}`), `variables jsonb` (lista declarada de variáveis suportadas — `DP-04`), `locale` (default `pt-BR`), `enabled boolean`, `version int`, timestamps.
- **Relacionamentos:** 1:N `notification_rules`; referenciado por `notification_deliveries` (snapshot).
- **Chaves/índices:** único `(space_id, name, version)`; índice `(space_id, enabled)`.
- **Constraints:** `body` não vazio; validação de placeholders contra `variables` no save.
- **Isolamento:** ADMIN gerencia templates do espaço; SUPER_ADMIN gerencia globais (`DP-31`).
- **Auditoria:** criação/edição/versão.
- **Riscos:** `RT-14` — placeholder inválido em runtime (variável ausente) → mensagem quebrada enviada ao cliente. Mitigação: renderização estrita + fallback + teste de template.

### 5.13 `notification_deliveries`

- **Finalidade:** uma tentativa/registro de entrega de uma notificação a um destinatário.
- **Campos:** `id`, `space_id`, `rule_id`, `template_id`, `template_version`, `process_id`, `movement_id` (evento gerador, quando aplicável), `audience`, `recipient_type` (`profile`/`client`), `recipient_id`, `recipient_phone` (E.164, snapshot), `channel` (`whatsapp`), `rendered_body` (snapshot do texto enviado), `dedupe_key` (única — seção 9), `status` enum (`pending`/`queued`/`sending`/`sent`/`delivered`/`read`/`failed`/`skipped`), `waha_message_id`, `attempts int`, `next_attempt_at`, `last_error`, `created_at`, `updated_at`, `sent_at`, `delivered_at`.
- **Relacionamentos:** N:1 `notification_rules`, `message_templates`, `processes`, `process_movements`.
- **Chaves/índices:** **único `dedupe_key`** (idempotência, RN16); índice `(status, next_attempt_at)` (retry worker); índice `(space_id, created_at desc)` (UI); índice `waha_message_id` (correlação de webhook).
- **Constraints:** `status` enum; `recipient_phone` formato E.164.
- **Isolamento:** ADMIN vê deliveries do espaço; COLABORADOR vê as dos próprios processos (`PP-07`). SUPER_ADMIN: sem acesso ao conteúdo (pode ver **contagens agregadas** para billing? `PP-08`).
- **Auditoria:** transições de status registradas (na própria linha + `audit_logs` para falhas).
- **Riscos:** `RT-15` — webhook do WAHA chega antes do commit da linha de delivery (corrida); `waha_message_id` + upsert. `RT-16` — RN12: erro de envio **nunca** pode escrever em `processes`/`process_movements`; o dispatch é transação separada.

### 5.14 `audit_logs`

- **Finalidade:** trilha de auditoria imutável de ações relevantes.
- **Campos:** `id`, `space_id` (nulo para ações globais do SUPER_ADMIN), `actor_id` (profile; nulo para ações de sistema/job), `actor_type` (`user`/`system`/`job`), `action` (verbo namespaced: `process.transfer`, `rule.update`, `waha.session.connect`, ...), `entity_type`, `entity_id`, `before jsonb`, `after jsonb`, `context jsonb` (ip, user agent, job run id), `created_at`.
- **Chaves/índices:** índice `(space_id, created_at desc)`; índice `(entity_type, entity_id)`; índice `(actor_id, created_at)`.
- **Constraints:** **append-only** (sem UPDATE/DELETE — revogar até para o dono do banco via policy + `REVOKE`); `action` not null.
- **Isolamento:** ADMIN lê auditoria do próprio espaço; COLABORADOR **não** lê auditoria (`PP-09`); SUPER_ADMIN lê auditoria **global** (ações administrativas) mas **não** os `before/after` que contenham conteúdo operacional sensível (`RT-01`, `DP-07`).
- **Auditoria:** —
- **Riscos:** `RT-17` — `before/after` pode vazar conteúdo operacional para quem não deveria ver (ex.: SUPER_ADMIN lendo diff de processo). Precisa de redação/campo `sensitive boolean` e policy que filtra.

### 5.15 Entidades adicionais sugeridas (`INFERÊNCIA TÉCNICA`)

O brief não as nomeia, mas o pipeline exige:

| Tabela | Motivo |
|---|---|
| `job_runs` | Monitoramento de execução de jobs (brief pede "monitoramento das execuções"). Campos: `job_name`, `space_id?`, `started_at`, `finished_at`, `status`, `stats jsonb`, `error`. |
| `collection_runs` | Uma execução de coleta por `(process, source)`: início, fim, nº de movimentações novas, status, hash de estado antes/depois. Base da idempotência e do detector. |
| `waha_sessions` | Sessão WhatsApp **por espaço** (RN14): `space_id` (único), `waha_session_name`, `status` (`disconnected`/`qr`/`connecting`/`connected`/`failed`), `phone_number`, `last_status_at`, `credentials_ref` (Vault). |
| `notification_events` | Evento canônico emitido pelo detector antes do motor de regras (desacopla detecção de notificação). Alternativa: fila. Ver `DP-32`. |
| `plans` / `plan_limits` | Se F18 for confirmada (`DP-08`). |
| `user_invitations` | Se o fluxo de convite (`DP-09`) exigir token/expiração fora de `space_members`. |

Confirmar inclusão em `PP-10` (essas tabelas alteram o modelo além do que o brief lista).

### 5.16 Diagrama de relacionamentos (alto nível)

```
auth.users 1─1 profiles ─┬─<space_members>─ spaces ─┬─< processes >─┬─< process_movements
                         │                          │               ├─< process_clients >── clients
                         │                          │               └─1 process_tracking_configs
                         │                          ├─< notification_rules >─ message_templates
                         │                          ├─< notification_deliveries
                         │                          ├─< waha_sessions (1 por space)
                         │                          └─< audit_logs
courts 1─< court_aliases          courts 1─< processes           (courts/court_aliases = catálogo global)
```

---

## 6. Fluxos principais

### 6.1 Cadastro de processo (`DEFINIDO`, seção 6 do brief)

```
ADMIN ou COLABORADOR abre "Novo processo"
  → informa número CNJ (ou marca "sem CNJ" — DP-24)
  → seleciona tribunal (courts; se ausente → solicita cadastro — RT-10)
  → define responsável atual (responsible_id):
        COLABORADOR: default = ele mesmo (pode escolher outro? PP-11)
        ADMIN: qualquer membro do espaço
  → vincula cliente(s) — OPCIONAL (RN8)
  → define configuração de acompanhamento (process_tracking_configs):
        fonte (derivada de court.tracking_strategy — DP-28), frequência, horário (default 08:00)
  → salva:
        created_by := auth.uid()  (imutável, RN2)
        responsible_id := escolhido (RN1)
        state_hash := null (ainda não coletado)
  → audit_logs: process.create
```

### 6.2 Ciclo de acompanhamento / coleta (o pipeline)

```
[Scheduler]  varre process_tracking_configs WHERE enabled AND next_run_at <= now()
             (rotina base: 08:00 diária — RN17; parâmetros DP-14)
    │
    ▼
[Coletor]    para cada (process, source): resolve o SourceAdapter da 'source'
             abre collection_run; chama adapter.fetch(process, source_params)
             adapter é a ÚNICA parte que conhece o tribunal (RN10)
    │  payload bruto da fonte
    ▼
[Normalizador]  movement-normalizer: payload → lista de MovimentaçãoCanônica
                { occurred_at, category_code, description, source_movement_id, raw }
                mapeia tribunal via courts/court_aliases (RN9)
    │
    ▼
[Processo/Estado]  calcula state_hash do conjunto normalizado
    │
    ▼
[Histórico]  upsert em process_movements por (process_id, source, content_hash)
             — idempotente (RN16); marca is_first_sync se era a 1ª coleta (RN11)
    │
    ▼
[Detector de Mudanças]  compara com estado anterior (state_hash / movimentações conhecidas)
             produz "eventos": new_movement, status_change, ...
             1ª coleta: registra tudo, mas NÃO emite evento notificável (RN11) — DP-03
             dedupe por content_hash (RT-06)
    │  eventos
    ▼
[Motor de Regras]  para cada evento: busca notification_rules aplicáveis
             (scope space|process, audience responsible|client, event_type, filter)
             resolve destinatários (responsible_id → profile.phone; process_clients → client.phone)
    │  (evento × regra × destinatário)
    ▼
[Templates]  renderiza message_templates.body com variáveis do evento (DP-04)
             validação estrita de placeholders (RT-14)
    │
    ▼
[Delivery]  cria notification_deliveries com dedupe_key único (RN16)
             status=pending
    │
    ▼
[WAHA]      gateway envia via sessão do espaço (waha_sessions)
             sucesso → status=sent + waha_message_id
             falha   → status=failed, agenda retry (next_attempt_at) — DP-10
             FALHA NUNCA TOCA processes/process_movements (RN12, RT-16)
    │
    ▼
[Webhook WAHA]  atualiza status: delivered / read / failed
    │
    ▼
[Auditoria]  job_runs + collection_runs + audit_logs registram cada etapa
```

### 6.3 Detecção de mudanças (detalhe) — ver seção 8.

### 6.4 Notificação (detalhe) — ver seção 9.

### 6.5 Transferência de responsabilidade (`DEFINIDO`, RN3/RN4)

```
ADMIN abre processo → "Transferir responsável"
  → seleciona novo membro do espaço
  → RPC process-transfer (Edge Function, SECURITY DEFINER):
        verifica auth_space_role(space_id) == 'ADMIN'  (não confia na UI — RN18)
        UPDATE processes SET responsible_id = novo
        NÃO altera created_by, NÃO altera process_movements (histórico preservado — RN3)
        audit_logs: process.transfer { before: {responsible_id: antigo}, after: {novo} }
  → efeito RLS imediato: responsável antigo (se COLABORADOR) perde acesso ao processo
        → ver RT-04 / PP-02 (acesso a movimentações passadas)
```

### 6.6 Conexão WhatsApp / QR Code (`DEFINIDO`, RN14/RN15)

```
ADMIN abre "WhatsApp" (COLABORADOR não vê o menu E a API recusa — RN15/RN18)
  → "Conectar":
        backend cria/ativa waha_sessions do space (nome de sessão isolado por space — DP-01)
        WAHA retorna QR Code → backend faz proxy do QR ao frontend (nunca expõe credencial)
  → ADMIN escaneia → WAHA emite evento 'connected' → webhook atualiza waha_sessions.status
  → "Desconectar" / "Reconectar": idem, sempre via ADMIN
  → credenciais/tokens WAHA: Supabase Vault, referenciados por credentials_ref (RT-12)
  → audit_logs: waha.session.connect / disconnect
```

### 6.7 Aniversário de cliente (`DEFINIDO` F13; parâmetros `DP-05`)

```
[Job diário]  seleciona clients WHERE birth_date "hoje" (mês/dia) por space
              AND notification_opt_in (DP-26) AND type='PF'
  → aplica notification_rules de event_type='client_birthday' (existe esse tipo? DP-05)
  → template dedicado → delivery → WAHA
  → horário/fuso: DP-14 ; se não houver regra configurada, não envia nada
```

---

## 7. Estrutura de telas (frontend)

`DEFINIDO` (lista do brief) + `INFERÊNCIA TÉCNICA` (composição). Todas respeitam
Mobile `<768` / Tablet `768–1023` / Desktop `≥1024`.

| Rota | Tela | Perfis | Notas de responsividade |
|---|---|---|---|
| `/login` | Login (e recuperar senha) | público | mobile-first |
| `/` | Dashboard | ADMIN, COLABORADOR | cards empilham no mobile; conteúdo `DP-06` |
| `/processes` | Lista de processos | ADMIN (todos do espaço), COLABORADOR (só os seus — RN5) | tabela → cards no mobile |
| `/processes/new` | Cadastro de processo | ADMIN, COLABORADOR | stepper no mobile |
| `/processes/:id` | Detalhe do processo | conforme RLS | abas: dados / movimentações / clientes / acompanhamento / notificações |
| `/processes/:id/movements` | Movimentações | conforme RLS | lista virtual (RT-07); filtros por categoria/data |
| `/clients` | Lista/detalhe de clientes | ADMIN; COLABORADOR (vinculados — PP-03) | tabela → cards |
| `/courts` | Catálogo de tribunais | SUPER_ADMIN (edita); demais (leitura?) `PP-05` | desktop-first |
| `/settings` | Configurações do espaço | ADMIN | — |
| `/settings/notification-rules` | Regras de notificação | ADMIN (edita), COLABORADOR (lê — PP-07) | — |
| `/settings/templates` | Templates de mensagem | ADMIN; SUPER_ADMIN (globais — DP-31) | editor com preview |
| `/settings/whatsapp` | Integração WhatsApp / QR / status | **somente ADMIN** (RN14/RN15) | QR grande no mobile |
| `/settings/users` | Membros do espaço | ADMIN (gerencia), COLABORADOR (lê — DP-09) | — |
| `/audit` | Trilha de auditoria | ADMIN (do espaço); COLABORADOR não (PP-09) | tabela densa, desktop-first |
| `/admin` | Administração global (espaços, planos, catálogo) | **somente SUPER_ADMIN** | desktop-first |

Componentes transversais: seletor de espaço ativo (se `DP-11` = multi-espaço), badge de papel,
indicador de status da sessão WhatsApp (visível só a ADMIN), toasts de erro padronizados.

---

## 8. Detecção de mudanças (arquitetura)

Requisitos `DEFINIDO` (seção 8 do brief): armazenar estado anterior; armazenar movimentações;
identificar movimentações novas; identificar alterações; evitar notificações duplicadas;
registrar a 1ª coleta sem tratá-la como mudança histórica; manter idempotência.

### 8.1 Mecânica proposta (`INFERÊNCIA TÉCNICA`)

1. **Estado anterior:** `processes.state_hash` guarda o hash do último *snapshot normalizado*
   (conjunto ordenado de `content_hash` das movimentações conhecidas + campos de estado do
   processo). `collection_runs` guarda `state_hash_before` / `state_hash_after` de cada execução.
2. **Movimentações:** cada movimentação normalizada gera um `content_hash` determinístico a
   partir de campos estáveis (`occurred_at` truncado ao dia + `category_code` + `description`
   normalizada: trim, colapso de espaços, lowercase, remoção de acentuação/pontuação irrelevante).
   A **regra exata de normalização** que define "é a mesma movimentação" é `DP-03`.
3. **Novas:** movimentação cujo `(process_id, source, content_hash)` não existe em
   `process_movements` → INSERT. As demais → ignoradas (idempotência).
4. **Alterações:** se a fonte fornece `source_movement_id` estável e o texto muda, registra-se
   uma **nova linha** marcada como revisão (append-only, RT-06/RT-07) em vez de UPDATE — e
   emite-se evento `movement_amended` (notificável? `DP-03`).
5. **1ª coleta (RN11):** se não há `collection_runs` anterior para `(process, source)`, todas
   as movimentações são inseridas com `is_first_sync = true`; o detector **não emite eventos
   notificáveis** para elas — apenas `first_sync_completed` (informativo).
6. **Anti-duplicação de notificação:** `notification_deliveries.dedupe_key` =
   `hash(rule_id + recipient_id + event_type + movement_content_hash)` com **constraint
   UNIQUE**. Segunda tentativa de criar a mesma delivery → no-op (idempotente, RN16).
7. **Idempotência de coleta:** toda a coleta de um `(process, source)` numa run é uma
   transação; reexecução da mesma run (mesmo intervalo de fonte) não produz linhas novas.

### 8.2 O que é `DECISÃO PENDENTE`

`DP-03` — **critério de "mudança relevante"**: o brief não define. Perguntas abertas:
- Toda movimentação nova notifica, ou só categorias específicas (ex.: "publicação",
  "decisão", "sentença") e o resto é silencioso?
- Mudança de fase/instância conta como evento próprio?
- `movement_amended` (texto corrigido pela fonte) notifica?
- Há *quiet hours* / agrupamento (1 mensagem com N movimentações vs. N mensagens)?

Enquanto `DP-03` não for decidido, o detector emite **todos** os `new_movement` como eventos
e deixa o **filtro** por conta de `notification_rules.filter` (`DP-30`) — assim o comportamento
default é conservador e configurável, sem embutir regra de produto no núcleo.

---

## 9. Notificações (arquitetura)

Separação `DEFINIDO`: `Evento → Regra → Destinatário → Template → Delivery → WAHA`.

### 9.1 Princípios

- **Desacoplamento por evento:** o detector escreve `notification_events` (ou publica numa
  fila — `DP-32`); o motor de regras consome. Detecção não conhece WhatsApp.
- **Duas trilhas independentes (RN13):** regras com `audience=responsible` e `audience=client`
  são avaliadas separadamente; uma pode existir sem a outra.
- **Isolamento de falha (RN12/RT-16):** o envio roda em transação/serviço separado do
  pipeline de coleta. Falha de WAHA marca `notification_deliveries.status=failed` e agenda
  retry — **nunca** escreve em `processes`/`process_movements`.
- **Idempotência (RN16):** `dedupe_key` UNIQUE em `notification_deliveries` (ver 8.1.6).
- **Retry (`DP-10`):** proposta default — backoff exponencial (1min, 5min, 30min, 2h, 6h),
  máximo 5 tentativas, depois `status=failed` definitivo + alerta em `job_runs`. Parâmetros
  exatos dependem de produto/limites do WhatsApp.
- **Status de entrega:** `pending → queued → sending → sent → delivered → read`, ramo
  `failed`, ramo `skipped` (ex.: destinatário sem telefone / opt-out).
- **Logs:** cada transição em `notification_deliveries` (colunas + `audit_logs` para falha).

### 9.2 Renderização de template

`message_templates.body` com `{{variavel}}`; conjunto de variáveis **declarado** em
`variables` e **validado no save** e **no render** (RT-14). Variáveis disponíveis por
`event_type` (ex.: `{{processo.numero}}`, `{{movimentacao.descricao}}`,
`{{movimentacao.data}}`, `{{cliente.nome}}`, `{{responsavel.nome}}`) — **catálogo exato =
`DP-04`**. `rendered_body` é gravado como snapshot na delivery (auditoria + reenvio fiel).

### 9.3 `DECISÃO PENDENTE`

`DP-04` (variáveis/catálogo de templates), `DP-05` (aniversário: event_type e template),
`DP-10` (retry/backoff/limites), `DP-30` (filtros de regra), `DP-32` (fila vs. tabela de
eventos), `DP-33` (agrupamento de múltiplas movimentações numa mensagem).

---

## 10. WAHA (camada de transporte)

`DEFINIDO` (RN19): WAHA é **só transporte**. `DEFINIDO` (RN14/RN15): só ADMIN administra;
COLABORADOR não acessa sessão/QR/credenciais.

### 10.1 Topologia proposta (`INFERÊNCIA TÉCNICA`, pendente de `DP-01`)

- **Uma sessão WAHA por espaço** (`waha_sessions`, `space_id` único). Nome de sessão
  namespaced (`space_<id>`), sem colisão entre tenants.
- **WAHA Gateway** (módulo do backend): única parte que fala HTTP com o WAHA. Expõe ao
  resto do sistema operações de alto nível: `getStatus(space)`, `connect(space)` → QR,
  `disconnect(space)`, `sendText(space, phone, body)` → `messageId`.
- **Webhooks WAHA** (sessão + mensagem) recebidos por Edge Function `waha-webhook`,
  autenticados por segredo compartilhado, atualizam `waha_sessions.status` e
  `notification_deliveries.status`.
- **Credenciais:** URL base + API key do WAHA, e tokens de sessão, em **Supabase Vault**;
  referência por `credentials_ref` (RT-12). Nunca em `jsonb` claro, nunca no frontend.
- **QR Code:** o backend recebe do WAHA e repassa como imagem/string ao ADMIN; a credencial
  em si nunca trafega ao cliente.

### 10.2 `DECISÃO PENDENTE` — `DP-01` (hospedagem do WAHA)

Supabase **não** hospeda o contêiner WAHA (processo de longa duração + navegador). Opções:

| Opção | Prós | Contras |
|---|---|---|
| **A. WAHA único multi-sessão** (1 contêiner, N sessões) em VPS/Fly.io/Railway | barato, simples de começar | ponto único de falha; limite de sessões por instância; ruído entre tenants |
| **B. WAHA por espaço** (1 contêiner por tenant) | isolamento forte; falha contida | custo e orquestração muito maiores; provisionamento dinâmico |
| **C. WAHA gerenciado / API terceirizada** | zero operação | custo recorrente; dependência externa; termos de uso do WhatsApp |
| **D. Pool de instâncias multi-sessão** (N contêineres, sessões distribuídas) | escala horizontal; falha contida | orquestração de roteamento sessão→instância |

Recomendação técnica inicial (sem decidir): **A** para MVP, com o Gateway abstraindo a
topologia para permitir migrar a **D** sem tocar no núcleo. **Precisa de decisão de produto**
por causa de custo, isolamento e SLA.

### 10.3 Riscos

`RT-18` — banimento/queda de número WhatsApp derruba as notificações de um espaço inteiro;
precisa de alerta a ADMIN + status visível. `RT-19` — rate limit do WhatsApp; o dispatch
precisa de *throttling* por sessão. `RT-20` — reconexão exige novo QR presencial; runbook.

---

## 11. Jobs e automações

`INFERÊNCIA TÉCNICA` na composição; existência `DEFINIDO`.

| Job | Gatilho | Idempotência | Retry | Observabilidade |
|---|---|---|---|---|
| `tracking.schedule` (rotina base) | cron **08:00** diário (RN17; fuso `DP-14`) | seleciona por `next_run_at`; marca `last_run_at` | reenfileira falhas individuais | `job_runs` |
| `collection.run` (por processo×fonte) | despachado por `tracking.schedule` ou event-driven (`DP-14`) | `(process, source)` + intervalo de fonte; `collection_runs` | por item, backoff | `collection_runs` |
| `movements.process` (normaliza + persiste) | após `collection.run` | `content_hash` UNIQUE | — | `job_runs` |
| `changes.detect` (detector) | após `movements.process` | `state_hash`; eventos idempotentes | — | `collection_runs` |
| `rules.eval` (motor de regras) | após `changes.detect` (evento/fila `DP-32`) | evento processado uma vez | — | `job_runs` |
| `notifications.dispatch` | após `rules.eval` | `dedupe_key` UNIQUE | backoff (`DP-10`), máx 5 | `notification_deliveries` |
| `notifications.retry` | cron a cada N min | lê `status=failed AND next_attempt_at<=now` | incrementa `attempts` | `job_runs` |
| `clients.birthday` | cron diário (fuso `DP-14`) | 1 envio por cliente/ano (`dedupe_key` com ano) | via dispatch | `job_runs` |
| `courts.datajud_sync` | cron semanal (`DP-34`) | upsert por `datajud_code` | — | `job_runs` |
| `jobs.monitor` | cron frequente | — | — | alerta em runs travadas/falhas |

**Scheduler:** `pg_cron` + `pg_net` para disparar Edge Functions (jobs leves) e/ou acordar o
`collector-worker` (jobs pesados / scraping) — depende de `DP-02`. **Concorrência:** lock por
`(space_id, job_name)` para não rodar a mesma coleta duas vezes em paralelo (`RT-21`).

`DP-14` consolidado: fuso de referência (UTC? America/Manaus? por espaço?), janelas de
execução, e se a coleta evolui de *pull* 08:00 para *event-driven* / múltiplas janelas.

---

## 12. Segurança

### 12.1 Autenticação

- Supabase Auth (email+senha; magic link opcional). Sessão JWT. Refresh automático no cliente.
- Política de senha, MFA, expiração de sessão: `DP-15`.
- `profiles.is_super_admin` define super admin; **não** é papel de `space_members`.

### 12.2 Autorização (defesa em profundidade — RN18)

Três camadas, **todas obrigatórias**:

1. **RLS no Postgres** — verdade final. Toda tabela com RLS ON. Policies por entidade
   (seção 5) usando `auth.uid()`, `auth_space_role(space_id)` e `is_super_admin()`
   (funções `SECURITY DEFINER`, estáveis, sem input do cliente — RT-02).
2. **API / RPC** — escritas sensíveis (transferência, avaliação de regras, envio, gestão de
   sessão WAHA, administração global) só via Edge Function/RPC `SECURITY DEFINER` que
   **revalida o papel** e valida entrada (schema) antes de agir.
3. **UI (Angular)** — route guards + diretivas de permissão apenas **escondem** o que o
   usuário não pode fazer. Nunca é a única barreira.

### 12.3 Isolamento por `space_id`

- Toda query operacional carrega `space_id`; RLS garante o recorte.
- `context.space_id` do cliente é **sugestão**; a policy confere associação real via
  `space_members`.
- Testes de isolamento automatizados (seção 14) tentam explicitamente cross-tenant e
  esperam `0 rows` / `403`.
- SUPER_ADMIN: policies **não** concedem SELECT/UPDATE em `processes`, `process_movements`,
  `clients`, `notification_deliveries`, `message_templates` de espaço (RN7). Acesso só a
  `spaces`, `plans`, catálogo, e auditoria global redigida (`RT-01`, `RT-17`).

### 12.4 Secrets e credenciais

- WAHA (URL, API key, tokens de sessão), chaves de APIs externas, segredo de webhook:
  **Supabase Vault** / secrets de Edge Function. Nunca em tabela clara, nunca no bundle
  Angular, nunca em `process_tracking_configs.source_params` claro (RT-12).
- Rotação: `DP-15`.

### 12.5 Superfície externa

- **Rate limiting**: por IP e por usuário nas Edge Functions públicas (login, webhook).
  Limites concretos `DP-15`.
- **Validação de entrada**: schema (zod/valibot) em toda Edge Function; no frontend, apenas
  UX.
- **Webhooks WAHA**: assinatura/segredo obrigatórios; rejeição silenciosa se inválido;
  idempotência por `waha_message_id`.
- **CORS**: origem restrita ao domínio do app.
- **Headers**: CSP, HSTS, X-Frame-Options no host do Angular.

### 12.6 Auditoria (segurança)

- `audit_logs` append-only, `REVOKE UPDATE/DELETE`.
- Auditar no mínimo: login/logout (`DP-07`), mudança de papel, transferência de processo,
  CRUD de regras/templates, conexão/desconexão WAHA, ações de SUPER_ADMIN, falhas de
  delivery, exclusão/anonimização de cliente (LGPD).
- `context` com IP e user agent quando disponível.

### 12.7 LGPD (`RT-08`, `PP-04`)

Dados pessoais de clientes (terceiros): base legal, opt-in explícito para WhatsApp
(`notification_opt_in`), direito a exclusão/anonimização, retenção de `audit_logs` vs.
direito ao esquecimento (conflito a resolver com produto/jurídico).

---

## 13. Estratégia de integrações

### 13.1 Contrato comum — `SourceAdapter` (port)

```ts
interface SourceAdapter {
  readonly source: 'datajud' | 'tjam_projudi' | string;
  supports(court: Court): boolean;
  fetch(input: {
    process: { cnjNumber: string | null; courtId: string; params?: Json };
    since?: Date;                 // coleta incremental quando a fonte suporta
  }): Promise<RawMovement[]>;      // payload bruto + metadados mínimos
}
```

O núcleo depende só dessa interface. **Adicionar tribunal/estratégia = novo adapter +
registro**, sem tocar detector, motor de regras, notificação ou auditoria (requisito
`DEFINIDO`).

### 13.2 DataJud (CNJ)

- **Papel primário (RN9):** referência estrutural → popula/atualiza `courts` e
  `court_aliases` (job `courts.datajud_sync`), e taxonomia de categorias de movimentação.
- **Papel secundário (`DP-12`):** a API Pública do DataJud também expõe movimentações de
  muitos tribunais; **pode** ser um `SourceAdapter` (`source='datajud'`). Decidir se é fonte
  de produção ou só *seed* estrutural.
- Autenticação: chave da API Pública DataJud (secret). Rate limit respeitado no adapter.

### 13.3 TJAM / Projudi (`DP-13`)

- **Isolado por requisito (RN10):** adapter próprio (`source='tjam_projudi'`) no
  `collector-worker`, provavelmente exigindo:
  - sessão autenticada / navegador headless (Projudi costuma exigir login e, às vezes,
    certificado/2FA/captcha);
  - credenciais: **de quem?** conta institucional do escritório? por advogado? → `DP-13`;
  - runtime que suporta browser (Edge Function não suporta) → `DP-02`.
- **Contenção de acoplamento (RN10):** se o TJAM cair ou mudar o HTML, só o adapter quebra;
  `collection_runs` marca `status=failed` e o resto do sistema segue. Testes de contrato
  com fixtures HTML versionadas.
- Risco legal/ToS de scraping: `RT-22` / `PP-12`.

### 13.4 WAHA — seção 10.

### 13.5 Registro de adapters

`services/collector-worker/src/adapters/index.ts` mapeia `source → adapter`. `courts.tracking_strategy`
(`DP-28`) indica qual `source` usar por tribunal. Nenhum `if (court === 'TJAM')` fora do adapter.

---

## 14. Estratégia de testes

| Camada | Ferramenta (`INFERÊNCIA`) | O que cobre |
|---|---|---|
| **Domínio puro** (`packages/domain`, `movement-normalizer`) | Vitest | detector de mudanças, hashing/normalização, motor de regras, renderização de template — sem I/O, 100% determinístico |
| **Contrato de adapters** | Vitest + fixtures | cada `SourceAdapter` contra payloads/HTML reais salvos; garante que mudança de fonte não quebra o canônico |
| **Banco / RLS** | pgTAP ou Vitest + client Supabase local | **cada policy**: COLABORADOR só vê seus processos; ADMIN vê o espaço; SUPER_ADMIN não vê conteúdo; cross-tenant = 0 rows; append-only de `audit_logs`/`process_movements` |
| **RPC / Edge Functions** | Deno test + Supabase local | `process-transfer` recusa não-ADMIN; `waha-webhook` valida assinatura; validação de schema; idempotência de `dedupe_key` |
| **Integração de pipeline** | Vitest + Supabase local + WAHA mock | coleta → normaliza → detecta → regra → delivery, com fonte fake; 1ª coleta não notifica (RN11); falha de WAHA não altera processo (RN12) |
| **E2E frontend** | Playwright | login por papel; COLABORADOR não vê menu WhatsApp nem `/admin`; breakpoints 768/1024; fluxo de cadastro de processo |
| **Contração de tipos** | `tsc` + tipos gerados do schema | frontend e worker compilam contra o mesmo `shared-types` |
| **Carga (posterior)** | k6 | job das 08:00 com N processos; throttling WAHA |

Gate de CI: lint + typecheck + testes de domínio + testes de RLS **obrigatórios** para merge.
Migrations rodam em banco efêmero no CI (dry-run + up + down).

---

## 15. Roadmap de implementação

Adaptado da referência do brief à arquitetura acima. Cada fase termina com seus critérios de
aceite (seção 16) verdes.

| Fase | Nome | Entrega principal | Depende de |
|---|---|---|---|
| **0** | **Fundação do repo** | Monorepo pnpm, `apps/web` Angular scaffold, `supabase/` init, `packages/*`, CI (lint/typecheck/test), `.env.example`, ADRs, README expandido | — |
| **1** | **Auth & Identidade** | Supabase Auth, `profiles`, login/logout/recuperação no Angular, guard base | 0 |
| **2** | **Multi-tenancy & Membros** | `spaces`, `space_members`, função `auth_space_role`, `is_super_admin`, seletor de espaço, RLS base | 1 |
| **3** | **Banco & RLS core + Auditoria** | Todas as migrations das 14 entidades + tabelas de apoio, **todas as policies**, `audit_logs` append-only, testes pgTAP de isolamento | 2 |
| **4** | **Tribunais & Catálogo** | `courts`, `court_aliases`, `courts.datajud_sync` (seed estrutural), tela `/courts` | 3 |
| **5** | **Processos** | CRUD `processes`, `responsible_id`/`created_by`, RPC `process-transfer` (só ADMIN), telas lista/detalhe/novo, RLS do COLABORADOR verde | 3, 4 |
| **6** | **Clientes** | CRUD `clients`, `process_clients`, opt-in, telas | 5 |
| **7** | **Acompanhamento** | `process_tracking_configs`, scheduler `pg_cron`, `collector-worker` esqueleto, port `SourceAdapter` | 5 |
| **8** | **Coleta — DataJud adapter** | `SourceAdapter` DataJud, `collection_runs`, `movement-normalizer`, `process_movements` idempotente | 7 |
| **9** | **Motor de mudanças** | detector, `state_hash`, `is_first_sync` (RN11), eventos canônicos, testes de domínio | 8 |
| **10** | **Notificações (sem envio real)** | `notification_rules`, `message_templates`, `rules.eval`, `notification_deliveries` com `dedupe_key`, render de template, telas | 9 |
| **11** | **WAHA** | `waha_sessions`, Gateway, `waha-webhook`, QR/status/connect/disconnect (só ADMIN), envio real, retry | 10, `DP-01` |
| **12** | **Coleta — TJAM/Projudi adapter** | adapter isolado no worker, runtime com browser (`DP-02`), fixtures de contrato | 8, `DP-02`, `DP-13` |
| **13** | **Jobs completos** | `notifications.retry`, `clients.birthday`, `jobs.monitor`, `job_runs`, locks de concorrência | 11 |
| **14** | **Dashboard** | métricas (`DP-06`), responsivo | 5–13 |
| **15** | **Planos & limites** | `plans`/`plan_limits`, enforcement (`DP-08`) — **só se produto confirmar F18** | 3 |
| **16** | **Hardening & Deploy** | rate limiting, CSP, rotação de secrets (`DP-15`), runbooks, staging→prod, testes de carga | todas |

Fases 0–3 são pré-requisito de tudo. Fases 11 e 12 estão **bloqueadas** por decisões
pendentes (`DP-01`, `DP-02`, `DP-13`) — o roadmap pode avançar até a fase 10 sem elas.

---

## 16. Critérios de aceite (por módulo)

Priorizando o verificável por teste automatizado.

**Fundação (F0)**
- `pnpm install && pnpm -r build` verde; CI roda lint+typecheck+test em PR.
- `supabase start` sobe local; `supabase db reset` aplica todas as migrations e o `down`.

**Auth (F1)**
- Usuário sem sessão em rota protegida → redirect `/login` (E2E).
- Token expirado → refresh transparente ou logout limpo.

**Multi-tenancy (F2/F3)**
- `auth_space_role` retorna o papel correto e `null` para não-membro (teste SQL).
- Query de `processes` sem `space_id` do usuário retorna `0 rows` (teste RLS).
- Tentativa de ler dado de outro espaço → `0 rows` / `403` em **toda** tabela operacional (suite cross-tenant).
- `audit_logs`: `UPDATE`/`DELETE` falham para qualquer papel (teste SQL).
- SUPER_ADMIN: `SELECT` em `processes`/`process_movements`/`clients`/`notification_deliveries` retorna `0 rows` (teste RLS — RN7).

**Tribunais (F4)**
- `courts.datajud_sync` é idempotente: rodar 2x não duplica (`datajud_code` UNIQUE).
- Alias novo casa texto de fonte com o `court_id` certo (teste de normalização).

**Processos (F5)**
- COLABORADOR lista **apenas** processos com `responsible_id = auth.uid()` (teste RLS + E2E).
- `created_by` não muda em `UPDATE` (trigger; teste SQL).
- `process-transfer` chamado por COLABORADOR → `403`; por ADMIN → troca `responsible_id`, **não** altera `created_by` nem `process_movements`, grava `audit_logs` (teste RPC).
- Após transferência, ex-responsável COLABORADOR não vê mais o processo (teste RLS).

**Clientes (F6)**
- Cliente sem `notification_opt_in` nunca gera `notification_deliveries` (teste de pipeline).
- Exclusão de cliente anonimiza dados e mantém `audit_logs` (teste + `PP-04`).

**Acompanhamento (F7)**
- Scheduler seleciona só `enabled AND next_run_at <= now()` (teste SQL).
- Dois workers não processam o mesmo `(process, source)` em paralelo (teste de lock — RT-21).

**Coleta/DataJud (F8)**
- Reexecução da mesma coleta não cria linhas novas em `process_movements` (`content_hash` UNIQUE — RN16).
- Payload malformado → `collection_runs.status=failed`, sem exceção não tratada, resto do sistema segue.

**Motor de mudanças (F9)**
- 1ª coleta de um processo: todas as movimentações inseridas com `is_first_sync=true` e **nenhum** evento notificável emitido (RN11) — teste de domínio.
- 2ª coleta com 1 movimentação nova: exatamente 1 evento `new_movement` (teste de domínio).
- Coleta idêntica repetida: 0 eventos.

**Notificações (F10)**
- Regra `audience=responsible` e regra `audience=client` são independentes: desabilitar uma não afeta a outra (RN13 — teste).
- Criar a mesma delivery 2x (mesmo `dedupe_key`) → 1 linha (RN16 — teste SQL).
- Template com placeholder não declarado → erro no save; variável ausente no render → `status=skipped` com motivo, **sem** enviar texto quebrado (RT-14).

**WAHA (F11)**
- Falha simulada do WAHA no envio → `notification_deliveries.status=failed` + retry agendado; **nenhuma** escrita em `processes`/`process_movements` (RN12 — teste de integração).
- COLABORADOR: `GET /whatsapp/*` e RPCs de sessão → `403`; menu ausente (RN15 — teste RPC + E2E).
- Webhook com assinatura inválida → ignorado, sem mudança de estado.
- `waha_message_id` recebido 2x → estado convergente, sem duplicar (idempotência).

**Jobs (F13)**
- `clients.birthday`: 1 envio por cliente por ano (dedupe com ano — teste).
- `notifications.retry`: respeita backoff e para em `max_attempts` (`DP-10` — teste).
- `jobs.monitor` sinaliza run que passou do tempo limite (teste).

**Auditoria (F3/transversal)**
- Toda ação da lista de 12.6 gera exatamente 1 `audit_logs` com `before/after` coerentes (testes por ação).

**Frontend / responsividade (transversal)**
- Layout não quebra em 767 / 768 / 1023 / 1024 px (Playwright viewport).
- Elementos restritos por papel não aparecem no DOM para quem não tem permissão (E2E) — **e** a API recusa mesmo se forçada (RN18).

---

## 17. DECISÕES PENDENTES

| ID | Tema | Impacto | Proposta técnica (não decidida) |
|---|---|---|---|
| **DP-01** | Hospedagem/topologia do WAHA | custo, isolamento, SLA | MVP: 1 WAHA multi-sessão em VPS/Fly; Gateway abstrai p/ migrar a pool |
| **DP-02** | Runtime dos coletores pesados / scraping (Edge Function não serve) | infra, custo | `services/collector-worker` Node em Fly/Railway/container; `pg_cron`+`pg_net` acorda o worker |
| **DP-03** | Critério de "mudança relevante" e regra de normalização de movimentação | núcleo de notificação | default conservador: todo `new_movement` vira evento; filtro fica em `notification_rules.filter` |
| **DP-04** | Catálogo de variáveis dos templates por `event_type` | conteúdo das mensagens | declarar `variables` por template + validação estrita |
| **DP-05** | Aniversário: existe `event_type='client_birthday'`? template e horário próprios? | feature F13 | job diário + regra dedicada; sem regra configurada, não envia |
| **DP-06** | Conteúdo/métricas do dashboard | feature F15 | placeholder até definição |
| **DP-07** | Escopo fino da auditoria (o quê, retenção, quem lê, leituras sensíveis) | compliance | lista mínima em 12.6; retenção a definir |
| **DP-08** | Existência e regras de planos/limites (F18) | billing, enforcement | fase 15 opcional; só implementar se confirmado |
| **DP-09** | Fluxo de convite de usuários; "≥1 ADMIN ativo por espaço"; o que COLABORADOR vê em `/users` | UX, integridade | `user_invitations` com token/expiração; trigger de proteção do último ADMIN |
| **DP-10** | Política de retry/backoff/limites de envio | entrega, ToS WhatsApp | 1m/5m/30m/2h/6h, máx 5, depois `failed` |
| **DP-11** | Usuário pode estar em vários espaços com papéis diferentes? | sessão, UX | `space_members` sugere que sim; seletor de espaço |
| **DP-12** | DataJud como fonte de movimentações em produção (além de estrutural) | cobertura de coleta | disponível como `SourceAdapter`; decidir se é produção |
| **DP-13** | TJAM/Projudi: mecanismo (API/scraping), de quem são as credenciais, 2FA/captcha | viabilidade da coleta TJAM | adapter isolado; credenciais em Vault; browser headless no worker |
| **DP-14** | Fuso de referência, janelas de execução, pull-08:00 vs. event-driven | comportamento dos jobs | começar 08:00 (fuso a definir); arquitetura permite evoluir |
| **DP-15** | Parâmetros de segurança: política de senha, MFA, rate limits, rotação de secrets | segurança | valores concretos a definir; mecanismos já previstos |
| **DP-16** | Quais telas são mobile-first obrigatórias | frontend | operação = mobile-first; admin = desktop-first (suspeita) |
| **DP-17** | Biblioteca de componentes Angular (Material / PrimeNG / CDK puro) | frontend, velocidade | Angular Material + CDK como default |
| **DP-18** | Nx vs. Turborepo vs. pnpm puro | DX, CI | pnpm workspaces + Nx |
| **DP-19** | Formato/obrigatoriedade de telefone (E.164) para profile e client | notificação | E.164 obrigatório para quem recebe WhatsApp |
| **DP-20** | `internal_ref` (referência interna do escritório) no processo | modelo | campo opcional |
| **DP-21** | Modelar instância/grau do processo | modelo | campo enum opcional |
| **DP-22** | Estados possíveis do processo (`active`/`archived`/`closed`/...) | modelo, UX | enum a confirmar |
| **DP-23** | Um processo tem 1 ou N configs de acompanhamento (multi-fonte simultânea)? | pipeline | modelar `(process, source)` único; N linhas possíveis |
| **DP-24** | Permitir processo sem número CNJ (físico/sigiloso)? | cadastro | permitir com flag; coleta desabilitada |
| **DP-25** | CPF/CNPJ do cliente é obrigatório? único por espaço? | modelo | único quando presente; não obrigatório |
| **DP-26** | Consentimento (opt-in) do cliente para WhatsApp é pré-requisito de envio? | LGPD, entrega | sim por padrão (`notification_opt_in`) |
| **DP-27** | Vocabulário de papéis do cliente no processo (`autor`/`réu`/...) | modelo | enum a definir |
| **DP-28** | Como se define a estratégia de coleta por tribunal (`courts.tracking_strategy`) | integração | campo no catálogo, default `datajud` |
| **DP-29** | Uso de `confidence` em `court_aliases` (matching automático) | qualidade de dados | manter campo; limiar a definir |
| **DP-30** | Filtros em `notification_rules.filter` (por categoria, etc.) | comportamento | `jsonb` de filtro; esquema a definir |
| **DP-31** | Templates globais (do sistema) vs. só por espaço | conteúdo | permitir `space_id` nulo = global (SUPER_ADMIN) |
| **DP-32** | Eventos: tabela `notification_events` vs. fila (pgmq/externa) | arquitetura | tabela para MVP; interface permite trocar por fila |
| **DP-33** | Agrupar N movimentações numa mensagem vs. 1 mensagem por movimentação | UX da notificação | default 1 por movimentação; agrupamento configurável depois |
| **DP-34** | Frequência do `courts.datajud_sync` | manutenção catálogo | semanal |
| **DP-35** | `SUPER_ADMIN` pode enxergar/gerir `space_members` e `profiles`? | isolamento vs. provisionamento | Assumido **SIM** — necessário para criar espaço + designar o 1º ADMIN. Produto pode vetar; ajuste isolado nas políticas 0004/0005. |
| **DP-36** | Self-signup cria espaço automaticamente? | onboarding | Assumido **NÃO** — só `SUPER_ADMIN` provisiona espaços na fundação. |

---

## 18. RISCOS TÉCNICOS

| ID | Risco | Severidade | Mitigação proposta |
|---|---|---|---|
| **RT-01** | "SUPER_ADMIN sem conteúdo operacional" exige policies cirúrgicas; fácil vazar via join/auditoria | Alta | policies explícitas de negação; suite de teste dedicada; auditoria redigida (RT-17) |
| **RT-02** | `is_super_admin` / checagem de papel manipulável se policy usar subselect frágil | Alta | funções `SECURITY DEFINER` estáveis; nunca confiar em claim do cliente |
| **RT-03** | Espaço fica sem ADMIN ativo | Média | trigger "≥1 ADMIN ativo"; bloquear rebaixamento/remoção do último |
| **RT-04** | Transferência tira do COLABORADOR o acesso a movimentações que ele precisa consultar | Média | `PP-02`: manter acesso somente-leitura ao histórico até a data da transferência? |
| **RT-05** | Processo sem CNJ (físico/sigiloso) não cabe no modelo atual | Média | `DP-24`: CNJ opcional + coleta off |
| **RT-06** | Mesma movimentação com textos diferentes entre fontes → duplicidade | Alta | regra de normalização estável (`DP-03`); `content_hash` canônico |
| **RT-07** | Volume de movimentações em processos antigos (paginação, índice, UI) | Média | índices desde o início; lista virtual; coleta incremental (`since`) |
| **RT-08** | LGPD: dados de terceiros (clientes) sem base legal/opt-in/exclusão | Alta | opt-in explícito; anonimização; revisão jurídica (`PP-04`) |
| **RT-09** | `space_id` divergente entre `process`/`client`/`process_clients` | Média | trigger de consistência |
| **RT-10** | Catálogo de tribunais incompleto trava cadastro de processo | Média | seed DataJud amplo + fila "tribunal solicitado" |
| **RT-11** | Alias ambíguo aponta p/ tribunais diferentes | Baixa | `confidence` + revisão manual |
| **RT-12** | Credenciais em `source_params jsonb` claro | Alta | Supabase Vault; só referência na tabela |
| **RT-13** | Regras sobrepostas → mensagens duplicadas ao mesmo destinatário | Média | dedupe no dispatch (`dedupe_key`) + `priority` |
| **RT-14** | Template com variável ausente → mensagem quebrada ao cliente | Média | validação estrita no save e no render; `status=skipped` |
| **RT-15** | Webhook WAHA chega antes do commit da delivery | Média | upsert por `waha_message_id`; idempotência |
| **RT-16** | Falha de envio contamina estado do processo (viola RN12) | Alta | dispatch em transação/serviço separado; nunca escreve em `processes` |
| **RT-17** | `audit_logs.before/after` vaza conteúdo operacional a quem não pode ver | Alta | flag `sensitive`; redação; policy de leitura por papel |
| **RT-18** | Banimento/queda do número WhatsApp derruba notificações do espaço | Alta | status visível a ADMIN; alerta; runbook de reconexão |
| **RT-19** | Rate limit do WhatsApp / risco de ban por volume | Alta | throttling por sessão; backoff; limites (`DP-10`) |
| **RT-20** | Reconexão WAHA exige QR presencial | Média | alerta proativo; runbook; janela de manutenção |
| **RT-21** | Concorrência: mesma coleta rodando 2x em paralelo | Média | lock `(space_id, job_name)`; seleção atômica de `next_run_at` |
| **RT-22** | Scraping do TJAM/Projudi: fragilidade a mudança de HTML + risco de ToS/legal | Alta | adapter isolado (RN10); testes de contrato; `PP-12` (aval. jurídica) |
| **RT-23** | Edge Functions não suportam navegador headless → coleta TJAM inviável nelas | Alta | `collector-worker` dedicado (`DP-02`) |
| **RT-24** | `pg_cron` como único scheduler: visibilidade e retry limitados | Média | `job_runs` + `jobs.monitor`; migrar a orquestrador dedicado se preciso |
| **RT-25** | Migrations grandes de RLS difíceis de revisar/testar | Média | 1 migration por entidade + testes pgTAP por policy no CI |
| **RT-26** | Acoplamento acidental "tribunal específico" vazando pro núcleo | Alta | lint/arquitetura: `packages/domain` proibido de importar adapters; code review |
| **RT-27** | Bundle Angular expondo lógica/segredo | Média | segredos só no backend; feature flags server-side; CSP |

---

## 19. PERGUNTAS QUE PRECISAM DE DECISÃO DO PRODUTO

| ID | Pergunta |
|---|---|
| **PP-01** | `SUPER_ADMIN` nunca aparece em `space_members`, certo? É sempre global via `profiles.is_super_admin`? |
| **PP-02** | Quando um processo é transferido, o COLABORADOR anterior deve manter acesso somente-leitura às movimentações até a data da transferência, ou perde acesso total? |
| **PP-03** | O COLABORADOR enxerga clientes: (a) só os vinculados aos processos onde é responsável, ou (b) todos os clientes do espaço? |
| **PP-04** | Qual a base legal LGPD para enviar WhatsApp a clientes? Opt-in explícito obrigatório? Como tratar exclusão de cliente vs. retenção de auditoria? |
| **PP-05** | Quem cadastra tribunal fora do catálogo DataJud: só SUPER_ADMIN, ou ADMIN pode criar um tribunal "local" no próprio espaço? |
| **PP-06** | O COLABORADOR pode alterar a configuração de acompanhamento (fonte, frequência) dos próprios processos, ou só ligar/desligar? |
| **PP-07** | O COLABORADOR pode **ver** as regras de notificação e as entregas (`notification_deliveries`) dos próprios processos? |
| **PP-08** | O SUPER_ADMIN pode ver **contagens agregadas** de mensagens/processos por espaço (para billing), mesmo sem ver o conteúdo? |
| **PP-09** | O COLABORADOR tem acesso a alguma trilha de auditoria (ex.: histórico do próprio processo), ou auditoria é exclusiva de ADMIN? |
| **PP-10** | Aprova a inclusão das tabelas de apoio (`job_runs`, `collection_runs`, `waha_sessions`, `notification_events`, e opcionalmente `plans`/`user_invitations`) além das 14 nomeadas? |
| **PP-11** | No cadastro de processo, o COLABORADOR pode definir outro membro como responsável, ou o responsável inicial é sempre ele mesmo (e só ADMIN atribui a terceiros)? |
| **PP-12** | Há aval jurídico para automação de coleta no TJAM/Projudi (scraping / uso de credenciais institucionais)? |
| **PP-13** | "Mudança relevante" (`DP-03`): toda movimentação nova notifica, ou existe uma lista de categorias que disparam notificação e o resto é silencioso? |
| **PP-14** | Confirma que **planos e limites** (F18) fazem parte do escopo? Se sim, quais dimensões (nº de processos, nº de usuários, volume de mensagens)? |
| **PP-15** | Idioma/локали: só `pt-BR`? Há previsão de multi-idioma nos templates? |
| **PP-16** | Fuso horário de referência para os jobs das 08:00: UTC, `America/Manaus`, ou configurável por espaço? |

---

## 20. Próximo passo

**Aguardo autorização para iniciar a implementação.**

Sugestão de sequência de desbloqueio:
1. Responder `PP-01`, `PP-02`, `PP-03`, `PP-10`, `PP-13` (impactam modelo de dados e RLS — base de tudo).
2. Decidir `DP-01` e `DP-02` antes da Fase 7 (não bloqueiam Fases 0–6).
3. Decidir `DP-13` / `PP-12` antes da Fase 12.

Com o aval de produto nas perguntas da seção 19 e o "pode começar", inicio pela **Fase 0
(Fundação do repo)** e sigo o roadmap da seção 15, entregando fase a fase com os critérios de
aceite da seção 16 verdes.
