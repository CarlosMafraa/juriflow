# JuriFlow — Fase de Acompanhamento de Processos: Análise e Arquitetura

> **Análise aprovada. Acompanhamento-A IMPLEMENTADA (2026-09-03).** Migrations 0016–0021,
> pacotes `@juriflow/movement-normalizer` e `@juriflow/collector-engine` (com
> `MockSourceAdapter`), RPCs, `pg_cron` sweep, painel em `/processos/:id`. Verificado:
> pgTAP 115, Vitest 55, Angular 24, lint e build limpos, `db reset` do zero. **Sem** DataJud
> real, scraping ou worker (sub-fases B/C). As decisões da seção 21 foram respondidas
> (recomendações aceitas; fuso = America/Manaus).
> **Data:** 2026-09-02 · **Base:** decisões já vigentes do JuriFlow (Fases 1, 2.1, 3, ADRs).

---

## 1. Objetivo

Acompanhar **automaticamente** os processos cadastrados no JuriFlow: consultar fontes
externas em intervalos definidos, coletar movimentações processuais, **normalizá-las** para
um modelo interno único, **detectar movimentações novas e alterações relevantes**, registrar
tudo de forma **idempotente e auditável**, e **preparar um feed de eventos** que a Fase de
Notificações consumirá depois.

O núcleo de regras de negócio **não** pode acoplar-se a nenhuma fonte específica: adicionar
DataJud, TJAM/Projudi ou um scraper novo é registrar um adapter, sem tocar no detector, na
normalização ou no modelo de dados (ADR-0004; `packages/collectors-core` já existe como
camada de contratos).

---

## 2. Escopo desta fase

| # | Entrega | Observação |
|---|---|---|
| A1 | Modelo de dados aditivo: `process_tracking_configs`, `process_tracking_state`, `collection_runs`, `process_movements`, `process_change_events`, `job_runs` (+ armazenamento do payload bruto) | **Apenas tabelas novas.** Nada é alterado em `processes`/`clients`/`courts` |
| A2 | `@juriflow/movement-normalizer` — pacote **puro** (sem I/O): `RawMovement → CanonicalMovement`, `content_hash`, mapeamento de categorias | Testável isoladamente |
| A3 | **Detector de mudanças** — pacote puro: dado o estado anterior + a coleta atual, produz a lista de eventos (`new_movement`, `movement_amended`, `first_sync_completed`) | Sem semântica de "notificar" — só detecta |
| A4 | Fiação do `SourceRegistry` no runtime + **`MockSourceAdapter`** (fonte fake) para testes ponta a ponta | Nenhuma fonte real |
| A5 | Orquestração: seleção de configs elegíveis, `next_run_at`, locks de concorrência, sweep agendado (base 08:00), sweep de retry, `job_runs` | Scheduler via `pg_cron`/`pg_net` (ver DP-A) |
| A6 | RPC de **coleta manual** ("coletar agora") + RLS das tabelas novas | Sob as regras de acesso já vigentes |
| A7 | Frontend: no **detalhe do processo**, linha do tempo de movimentações + situação do acompanhamento por fonte | Reusa o design system |
| A8 | Testes: pgTAP (RLS, idempotência, append-only), Vitest (normalizador, detector), Angular (tela) | |

### Sub-fases seguintes (fora desta, mas planejadas aqui)

- **Acompanhamento-B** — **Adapter DataJud** (HTTP/JSON da API Pública do CNJ) + taxonomia de
  movimentos (TPU/CNJ) + runtime (Edge Function ou worker) + integração ao scheduler.
- **Fase 4 — Tribunais/DataJud estrutural** — `courts` completo, `court_aliases`, categorias
  de movimento; **pode precisar vir antes ou junto da B** (ver Dependências).
- **Acompanhamento-C** — `services/collector-worker` (contêiner Node) + **Adapter
  TJAM/Projudi** (consulta pública / scraping) + gestão de credenciais (Vault). Bloqueada por
  DP-A, DP-C, PP-12.
- **Fase de Notificações** — Motor de Regras consome `process_change_events`; templates; WAHA.

---

## 3. Fora de escopo (explícito)

- Implementar o **adapter DataJud** (fica na sub-fase B).
- Implementar **scraping** / consulta pública TJAM/Projudi (sub-fase C).
- Implementar **workers** / `collector-worker` (sub-fase C).
- **Migrations, alteração de RLS ou de tabelas existentes** — nada nesta etapa de análise.
- **Notificações**, `notification_rules`, `message_templates`, `notification_deliveries`.
- **WhatsApp / WAHA**.
- Aniversário de clientes, planos/limites.
- Resolução de destinatários de notificação (é da Fase de Notificações).
- Alterar `processes` para guardar `state_hash`/`tracking_enabled` — o estado de
  acompanhamento vive **em tabelas novas** (restrição "não alterar tabelas existentes").

---

## 4. Arquitetura

### 4.1 Pipeline (recorte desta fase)

```
[Scheduler] ──seleciona configs elegíveis──▶ [Dispatcher]
                                                  │  (uma coleta por (processo, fonte))
                                                  ▼
                                        [Collector runtime]
                                                  │  resolve SourceKind → ProcessDataSource (SourceRegistry)
                                                  ▼
                                       ProcessDataSource.fetch()  ── payload bruto (paginado)
                                                  │
                                                  ▼
                                      [armazenar RAW]  (collection_raw_payloads / Storage)
                                                  │
                                                  ▼
                                  @juriflow/movement-normalizer
                                                  │  RawMovement[] → CanonicalMovement[] (+ content_hash)
                                                  ▼
                                  upsert em process_movements
                                     ON CONFLICT (process_id, source_kind, content_hash) DO NOTHING
                                                  │
                                                  ▼
                                        [Detector de mudanças]
                                     compara com process_tracking_state (state_hash)
                                                  │
                                     ┌────────────┴─────────────┐
                                1ª coleta                    coletas seguintes
                                     │                            │
                          first_sync_completed        new_movement / movement_amended
                                     │                            │
                                     └────────────┬───────────────┘
                                                  ▼
                                    insert em process_change_events   ◀── feed para Notificações (fase futura)
                                                  │
                                                  ▼
                              atualiza process_tracking_state (state_hash, last_synced_at)
                                                  │
                                                  ▼
                                      grava collection_runs (status, contagens, hashes, erro)
                                                  │
                                                  ▼
                              job_runs (sweep)  ·  audit_logs (só mudanças de config / falhas relevantes)
```

Este pipeline **para** em `process_change_events`. Tudo depois disso (Motor de Regras →
Template → WAHA) é a Fase de Notificações.

### 4.2 Camadas e responsabilidades

| Camada | Onde | Conhece a fonte? |
|---|---|---|
| **Contratos** — `ProcessDataSource`, `SourceRegistry`, `RawMovement` | `packages/collectors-core` (já existe) | Não |
| **Adapters** — `DataJudAdapter`, `TjamProjudiAdapter`, `ScraperAdapter`, `MockSourceAdapter` | `services/collector-worker/src/adapters/*` (sub-fases) | **Sim — única camada que conhece** |
| **Normalização** — `movement-normalizer` | `packages/movement-normalizer` (novo, puro) | Só a taxonomia (via tabela), não o protocolo |
| **Detecção** — detector de mudanças | `packages/movement-normalizer` ou `packages/domain` (puro) | Não |
| **Orquestração** — scheduler, dispatcher, retry, locks | `pg_cron` + `pg_net` + RPCs + (sub-fase C) worker | Não |
| **Persistência** — tabelas novas + RLS | `supabase/migrations` (sub-fase A) | Não |

### 4.3 Runtime da coleta (DP-A)

- **DataJud** é API HTTP/JSON — cabe numa **Edge Function** (Deno) ou no worker.
- **TJAM/Projudi e scrapers** exigem sessão autenticada, navegador headless, retries longos —
  **Edge Function não serve** (RT-23). Precisam do **`collector-worker`** (contêiner Node).
- Proposta: o **scheduler** (pg_cron) marca configs elegíveis e enfileira; o **runtime** de
  cada fonte é um detalhe de deploy — o contrato `ProcessDataSource` é o mesmo. Onde o worker
  é hospedado e se DataJud roda em Edge Function ou worker = **DP-A** (decisão de produto/infra).

---

## 5. Fluxo completo da coleta (passo a passo)

1. **Elegibilidade.** O sweep (base **08:00**, ver DP-D) seleciona
   `process_tracking_configs` onde `enabled = true` **e** `next_run_at <= now()` **e** o
   processo correspondente está `status = 'active'` **e** `deleted_at is null` **e**
   (`cnj_number is not null` **ou** a fonte não exige CNJ). Processo sem CNJ, arquivado,
   encerrado ou excluído **não é coletado** (regras já aprovadas na Fase 3) — sem alterar
   `processes`, o scheduler apenas lê essas colunas.
2. **Lock.** Cria/atualiza um `collection_runs` com `status = 'running'`; índice único parcial
   `(process_id, source_kind) where status = 'running'` impede coleta concorrente da mesma
   dupla (RT-21).
3. **Resolução da fonte.** `SourceRegistry.create(config.source_kind)` → `ProcessDataSource`.
4. **Fetch.** `source.fetch({ target: { cnjNumber, courtId, params }, since?, requestId })`.
   O adapter trata **paginação** internamente e devolve `RawMovement[]` + metadados.
   - 1ª coleta: histórico completo (com **cap** de páginas; se atingir o cap → `partial`,
     continua no próximo run).
   - Coletas seguintes: incremental com **janela de sobreposição** (ex.: `since = último
     occurred_at − 7 dias`, ver DP-K) para pegar itens que chegaram atrasados; o dedup
     absorve a sobreposição.
5. **RAW.** Persiste a resposta bruta da run (para auditoria e re-normalização) —
   `collection_raw_payloads` (tabela jsonb) **ou** bucket de Storage `collection-raw/…` (DP-E).
6. **Normalização.** `movement-normalizer` converte cada `RawMovement` em `CanonicalMovement`
   `{ occurredAt, categoryCode, categoryLabel, description, sourceMovementId, raw, contentHash }`.
   Categoria não reconhecida → `categoryCode = null`, `categoryLabel = rótulo original`,
   `needs_review = true`.
7. **Persistência das movimentações.** `insert ... on conflict (process_id, source_kind,
   content_hash) do nothing` em `process_movements`. Marca `is_first_sync` conforme o estado.
8. **Detecção.** Calcula `state_hash` do conjunto ordenado de `content_hash` conhecidos para
   `(process, source)`. Compara com `process_tracking_state.state_hash`.
   - Igual → 0 eventos.
   - 1ª coleta (`first_sync_done = false`) → insere tudo com `is_first_sync = true`, emite
     **apenas** `first_sync_completed`, seta `first_sync_done = true` (RN11 — o histórico
     retroativo **não** vira `new_movement`).
   - Diferente → para cada movimentação nova: `new_movement`. Para cada movimentação com
     `source_movement_id` conhecido mas texto alterado: grava **nova linha** append-only
     marcada `revision_of` e emite `movement_amended`.
9. **Eventos.** Insere em `process_change_events` (`event_type`, `movement_id`, `occurred_at`,
   `detected_at`, `payload`, `consumed_at = null`). É o feed da Fase de Notificações.
10. **Estado.** Atualiza `process_tracking_state` (`state_hash`, `last_synced_at`,
    `last_movement_occurred_at`).
11. **Run.** Fecha `collection_runs` (`status`, `movements_fetched/new/updated`,
    `state_hash_before/after`, `duration_ms`, `error_*`, `next_retry_at`).
12. **Agendamento.** Calcula `next_run_at` (frequência + jitter). Em falha retriável, agenda
    o retry (backoff). `job_runs` registra o sweep (selecionados / despachados / falhados).
13. **Auditoria.** `audit_logs` registra apenas **mudanças de configuração**, **coleta
    manual**, **auto-pausa por falhas** e **correções manuais** de movimentação — não cada
    run de rotina bem-sucedida (isso é o `collection_runs`).

---

## 6. Modelo conceitual das novas entidades

> Todas com `id uuid`, `space_id uuid not null` (isolamento), `created_at`/`updated_at`,
> RLS `enable + force`. **Aditivas** — não alteram nenhuma tabela da Fase 3.

### `process_tracking_configs` — "acompanhe este processo nesta fonte"

| Campo | Tipo | Notas |
|---|---|---|
| `process_id` | uuid → `processes` (cascade) | |
| `source_kind` | text | `datajud` · `tribunal_api` · `projudi_tjam` · `scraper` · … (union aberto do `collectors-core`) |
| `enabled` | boolean | default `true` |
| `frequency` | interval / enum | default diário (DP-D) |
| `schedule_time` | time | default `08:00` (DP-D) |
| `next_run_at` | timestamptz | o scheduler varre por aqui |
| `last_run_at` / `last_run_status` | timestamptz / text | |
| `failure_count` | int | consecutivas; base da auto-pausa (DP-J) |
| `source_params` | jsonb | parâmetros **não sensíveis** (ex.: id do processo na fonte). Segredos → Vault (DP-C) |
| `credentials_ref` | text (nulo) | ponteiro para segredo no Vault, quando a fonte exige auth (DP-C) |
| `created_by` | uuid → `profiles` | |

- **1 ou N por processo?** DP-B (multi-fonte simultânea vs. fonte única). Chave única
  provável: `(process_id, source_kind)`.
- **Quem configura?** DP-F (COLABORADOR responsável liga/desliga? troca fonte? só ADMIN?).

### `process_tracking_state` — estado anterior para detecção (por processo × fonte)

| Campo | Tipo | Notas |
|---|---|---|
| `process_id` + `source_kind` | | único |
| `state_hash` | text | hash do conjunto ordenado de `content_hash` conhecidos |
| `first_sync_done` | boolean | RN11 |
| `last_synced_at` | timestamptz | última coleta com sucesso |
| `last_movement_occurred_at` | timestamptz | base do `since` incremental |

### `collection_runs` — cada execução de coleta (o log de execução)

| Campo | Tipo | Notas |
|---|---|---|
| `process_id` · `source_kind` · `tracking_config_id` | | |
| `trigger` | text | `scheduled` · `manual` · `retry` |
| `status` | text | `running` · `success` · `partial` · `failed` · `timeout` · `unavailable` |
| `attempt` | int | 1..N |
| `started_at` / `finished_at` / `duration_ms` | | |
| `movements_fetched` / `movements_new` / `movements_updated` | int | |
| `state_hash_before` / `state_hash_after` | text | |
| `error_code` / `error_message` / `http_status` | | classificação do erro |
| `raw_ref` | text | ponteiro para o payload bruto (DP-E) |
| `next_retry_at` | timestamptz | |

Append-mostly. Retenção → DP-G.

### `process_movements` — histórico canônico (append-only)

| Campo | Tipo | Notas |
|---|---|---|
| `process_id` · `source_kind` | | |
| `source_movement_id` | text (nulo) | id estável na fonte, quando existir |
| `occurred_at` | timestamptz (nulo se a fonte não informar; `needs_review`) | data da movimentação |
| `collected_at` | timestamptz | |
| `category_code` / `category_label` | text | taxonomia (TPU/CNJ como referência — RN9) |
| `description` | text | texto **normalizado para exibição** (original preservado no `raw`) |
| `raw` | jsonb | payload original **desta** movimentação |
| `content_hash` | text | determinístico (ver §9) |
| `is_first_sync` | boolean | RN11 |
| `revision_of` | uuid (nulo) → `process_movements` | quando é uma revisão de texto |
| `collection_run_id` | uuid → `collection_runs` | |

- **Único:** `(process_id, source_kind, content_hash)`.
- **Append-only:** sem UPDATE/DELETE pela aplicação; correção administrativa é nova linha +
  `audit_logs` (padrão de `audit_logs` da Fase 2).
- **RLS:** quem **lê o processo** lê as movimentações (`app.can_read_process`) → COLABORADOR
  responsável vê as dos seus processos; ADMIN vê as do espaço; após transferência o
  ex-responsável perde o acesso (consistente com a Fase 3) — DP-H para confirmar.

### `process_change_events` — feed de eventos (preparado para Notificações)

| Campo | Tipo | Notas |
|---|---|---|
| `process_id` | | |
| `event_type` | text | `new_movement` · `movement_amended` · `first_sync_completed` |
| `movement_id` | uuid (nulo) → `process_movements` | |
| `occurred_at` / `detected_at` | timestamptz | |
| `payload` | jsonb | categoria + trecho da descrição — o suficiente para renderizar mensagem depois |
| `consumed_at` | timestamptz (nulo) | a Fase de Notificações marca ao processar |

- Tabela **ou** fila (pgmq) → DP-I.
- Escrita **só** pelo detector (`SECURITY DEFINER` / `service_role`); leitura por ADMIN
  (+ responsável? DP-H).

### `job_runs` — monitoração dos sweeps do scheduler

`job_name`, `space_id?` (sweep global ou por espaço), `started_at`, `finished_at`, `status`,
`stats jsonb` (selecionados / despachados / falhados / duração), `error`.

### Armazenamento do payload bruto (DP-E)

Opção 1 — tabela `collection_raw_payloads (collection_run_id, payload jsonb, bytes, compressed)`.
Opção 2 — bucket de Storage `collection-raw/<space_id>/<process_id>/<run_id>.json`, com o
ponteiro em `collection_runs.raw_ref`.
Trade-off: tabela é simples e transacional mas cresce o banco; Storage é barato mas assíncrono.
**Contém dados pessoais** (partes, advogados) → mesma RLS/retenção das movimentações (LGPD, DP-G).

### Taxonomia de movimentos (`movement_categories`) e `court_aliases`

Referência estrutural DataJud (TPU/CNJ). **Onde entra?** DP-M: semear nesta fase (o
normalizador precisa mapear categorias) **ou** na Fase 4 (Tribunais/DataJud estrutural).
Recomendação: um mínimo aqui (categorias mais comuns) + o catálogo completo na Fase 4.

---

## 7. Relacionamento com `processes` (sem alterá-lo)

```
processes (Fase 3, INALTERADO)
   │ 1        1 │        1 │            1 │
   │            │          │              │
   ▼ N          ▼ N        ▼ N            ▼ N
process_tracking_configs   collection_runs   process_movements   process_change_events
   │ 1                                         ▲
   ▼ 1                                         │ (revision_of, self)
process_tracking_state (por process × source_kind)

process_movements.collection_run_id → collection_runs
process_change_events.movement_id  → process_movements
```

- `process_id` FK com `on delete cascade` (o soft delete de processo da Fase 3 apenas oculta;
  o cascade real só ocorre em exclusão física administrativa).
- **Nada é adicionado a `processes`.** "Sem CNJ ⇒ sem coleta", "arquivado ⇒ sem coleta",
  "encerrado ⇒ sem coleta" e "excluído ⇒ sem coleta" são checados pelo scheduler **lendo**
  `processes.cnj_number` / `processes.status` / `processes.deleted_at`.
- `assigned_user_id` (responsável atual) e `created_by` continuam governando **acesso** às
  movimentações via `app.can_read_process` — sem duplicar regra.

---

## 8. Estratégia de fontes

- **Contrato único** já existente: `ProcessDataSource` + `SourceRegistry`
  (`packages/collectors-core`). Adicionar fonte = registrar um adapter; **o núcleo não muda**.
- **`SourceKind`** é um union aberto (`datajud`, `tribunal_api`, `projudi_tjam`, `scraper`,
  ou qualquer string) — já definido.
- **DataJud** = fonte de **consulta** e **referência estrutural** (tribunais, categorias,
  aliases). **Pode ter atraso** em relação à movimentação real — a UI deve deixar isso
  explícito ("Fonte: DataJud — pode haver atraso"). Não é fonte única (RN9).
- **TJAM/Projudi e outras** = adapters isolados (API, webservice ou scraping). Uma fonte que
  quebra (mudança de HTML, indisponibilidade) fica **contida no adapter**: `collection_runs`
  marca `failed`/`unavailable` e o resto do sistema segue (RN10, RT-22/RT-23).
- **Escolha da fonte por processo** (ponto 4 / DP-B, DP-N):
  1. Ao habilitar acompanhamento, o app deriva a(s) fonte(s) do **tribunal** do processo,
     via uma tabela nova `court_tracking_strategies (court_id, source_kind, priority, params)`
     — aditiva, gerida pelo **SUPER_ADMIN** (catálogo global, como `courts`).
  2. Cria `process_tracking_configs` para cada estratégia aplicável.
  3. **ADMIN pode ajustar** por processo (habilitar/desabilitar uma fonte)? DP-F/DP-N.
  4. Sem estratégia cadastrada para o tribunal ⇒ processo fica "não acompanhado" com aviso
     (nada de coleta silenciosa).

---

## 9. Idempotência e normalização

### Idempotência (pontos 12, 16)

- **Movimentação:** `unique (process_id, source_kind, content_hash)` + `insert on conflict do
  nothing`. Quando a fonte fornece `source_movement_id` estável, ele entra na composição do
  hash (mais confiável que texto).
- **Run:** re-executar a coleta do mesmo intervalo não cria linhas novas nem eventos
  (`state_hash` inalterado ⇒ 0 eventos). Uma `collection_run` interrompida pode ser
  reprocessada com segurança.
- **Sweep:** o lock `(process_id, source_kind) where status='running'` garante que dois
  sweeps concorrentes não coletem a mesma dupla.

### Normalização (ponto 10) — `@juriflow/movement-normalizer` (puro)

- **Entrada:** `RawMovement` (do adapter) + contexto (`source_kind`, `court_id`).
- **Saída:** `CanonicalMovement { occurredAt, categoryCode, categoryLabel, description,
  sourceMovementId, raw, contentHash }`.
- **Mapeamento de categoria:** rótulo/código da fonte → `movement_categories` (TPU/CNJ como
  referência — RN9). Não reconhecido → `categoryCode = null` + `needs_review`.
- **Descrição:** guarda o texto original em `raw`; para **exibição** normaliza espaços; para
  o **hash** normaliza mais forte (trim, colapso de espaços, minúsculas, remoção de
  pontuação/acentuação irrelevante). **A regra exata que define "é a mesma movimentação" é
  `DP-P` (produto)** — enquanto não decidida, a proposta é a acima.
- **`content_hash`** = hash determinístico de `occurredAt` (truncado ao dia) + `categoryCode`
  (ou `categoryLabel` normalizado se sem código) + `descrição normalizada` + `source_movement_id`
  quando presente.
- **Tribunal:** o processo já tem `court_id`; `court_aliases` só é necessário quando a fonte
  devolve identificação de órgão a resolver (mais relevante na Fase 4).

---

## 10. Detecção de novas movimentações e alteração relevante (pontos 11, 13)

- **Nova:** `content_hash` inexistente em `process_movements` para `(process, source_kind)`.
- **Alteração:** `source_movement_id` conhecido, texto diferente ⇒ nova linha `revision_of` +
  evento `movement_amended` (append-only, nunca UPDATE).
- **1ª coleta (RN11):** tudo entra com `is_first_sync = true`; **nenhum** `new_movement`; só
  `first_sync_completed`.
- **`state_hash` por `(process, source)`:** se não mudou, nada aconteceu.
- **"Alteração relevante" (para notificar) = `DP-P` / PP-13 — decisão de produto.** Esta fase
  **emite todos** os `new_movement`/`movement_amended`; **o filtro do que é relevante o
  suficiente para gerar notificação pertence à Fase de Notificações** (`notification_rules.filter`).
  Assim o comportamento default é conservador e não embute regra de produto no detector.

### Dados incompletos / paginação / histórico (pontos 14, 15)

- **Página truncada / resposta parcial:** `collection_runs.status = 'partial'`; persiste o
  que foi validamente parseado; **não** avança o `state_hash` para "completo"; **não** emite
  `first_sync_completed`; o próximo run re-busca.
- **Campo obrigatório ausente numa movimentação** (ex.: sem data): DP-L — **pular e logar**
  vs. **gravar com `occurred_at = null` + `needs_review`**. Recomendação: gravar com
  `needs_review` (não perder informação).
- **Fonte omite itens antigos:** **nunca** apagar movimentações já gravadas — o histórico é
  aditivo.
- **1ª coleta com muito histórico:** paginação com **cap** de páginas por run; se atingir,
  `partial` e continua no próximo run até completar.
- **Incremental:** `since = last_movement_occurred_at − janela de sobreposição` (DP-K); o
  dedup absorve a sobreposição.
- **Exibição:** o histórico vem de `process_movements` (a fonte não é re-consultada para
  mostrar).

---

## 11. Erros, retry, timeout, indisponibilidade (pontos 6, 7)

**Classificação do erro** (em `collection_runs.error_code`):

| Classe | Exemplos | Retry? |
|---|---|---|
| `timeout` | resposta não chegou no limite da fonte | Sim (backoff) |
| `unavailable` | 5xx, conexão recusada, tribunal fora do ar | Sim (backoff) |
| `rate_limited` | 429 / quota da fonte (DataJud tem cota) | Sim (respeitando `Retry-After`) |
| `auth_failed` | credencial inválida/expirada, captcha | **Não** — alerta ADMIN para corrigir |
| `parse_error` | payload não parseável (mudança de contrato) | **Não** persistente — alerta |
| `not_found` | processo não existe na fonte | **Não** — marca e pausa aquela fonte |
| `unknown` | não classificado | Sim (limitado) |

- **Backoff** (proposta, DP-Q): 5 min · 15 min · 1 h · 3 h · 6 h; **máx. 5 tentativas**;
  depois `failed` definitivo, entra no `job_runs`/alerta e aparece no detalhe do processo.
- **Timeout por fonte** (proposta): DataJud 30 s, API tribunal 30 s, scraper 120 s —
  configurável em `court_tracking_strategies.params` (DP-R).
- **Indisponibilidade prolongada:** após **M** falhas consecutivas (DP-J, proposta M = 5), o
  acompanhamento daquela fonte é **auto-pausado** (`enabled = false` + motivo) e o ADMIN é
  alertado (`audit_logs` + aviso no detalhe do processo). Reativação é manual.
- **Falha de coleta nunca corrompe o processo** (análogo à RN12): erro fica em
  `collection_runs`; `process_movements` e `processes` não são tocados.

---

## 12. Observabilidade e auditoria (pontos 8, 17)

- **`collection_runs`** — registro de **toda** execução (agendada, manual, retry): início,
  fim, status, contagens, `state_hash` antes/depois, erro classificado, ponteiro do RAW.
  É o **log de execução da coleta**.
- **`job_runs`** — cada sweep do scheduler: quantas configs elegíveis, despachadas, falhadas,
  duração.
- **Logs estruturados** com `run_id` / `request_id` de correlação (mesmo padrão do ADR-0006:
  JSON, níveis, **redação** de segredos).
- **`audit_logs`** (via `app.write_audit_log`, infra da Fase 2) registra **apenas**:
  `tracking.enable` / `tracking.disable` / `tracking.source_change` / `tracking.params_change`
  / `tracking.credentials_update` / `tracking.manual_collect` / `tracking.auto_paused` /
  `movement.correct`. **Não** audita cada run de rotina bem-sucedida (isso é `collection_runs`).
- **Métricas preparadas:** runs/dia por fonte, taxa de sucesso, latência média, movimentações
  novas/dia, nº de configs pausadas, nº de movimentações `needs_review`.

---

## 13. Segurança (decisões já vigentes aplicadas)

- RLS `enable + force` em todas as tabelas novas; `space_id` obrigatório; predicados ancorados
  em `space_members` ativo (padrão da Fase 2/3).
- **`process_movements` / `collection_runs`:** leitura via `app.can_read_process` (ADMIN do
  espaço **ou** responsável atual). SUPER_ADMIN **sem** acesso operacional (RN7).
- **`process_tracking_configs`:** editar = ? DP-F (proposta: ADMIN gerencia fonte/params;
  COLABORADOR responsável só liga/desliga).
- **`process_change_events`:** escrita só pelo detector (`SECURITY DEFINER`); leitura ADMIN
  (+ responsável? DP-H).
- **Credenciais de fonte** (DataJud API key, login Projudi): **Supabase Vault** / env do
  worker; `credentials_ref` na config aponta para o segredo; **nunca** em `source_params`
  claro, **nunca** no bundle Angular (RT-12). Institucional (por espaço) vs. por advogado =
  **DP-C** + aval jurídico **PP-12**.
- **RAW payloads** contêm dados pessoais (partes, advogados) → mesma RLS das movimentações +
  **política de retenção** (LGPD) — DP-G.
- **Worker → banco:** via `service_role` (bypassa RLS), mas toda escrita é escopada pelo
  `space_id` da config; alternativa: role dedicada com grants mínimos. DP-S.
- **Coleta manual** ("coletar agora"): RPC `SECURITY DEFINER` que revalida permissão (ADMIN
  ou responsável? DP-F) e respeita rate limit por processo.

---

## 14. Informações no detalhe do processo (ponto 18)

- **Linha do tempo de movimentações**: data, categoria, descrição; ordenada; paginada;
  filtro por categoria/período; marcação de `needs_review`.
- **Situação do acompanhamento por fonte**: fonte, habilitado?, última coleta com sucesso,
  última tentativa, **último erro em linguagem amigável**, próxima execução agendada, "1ª
  coleta em andamento".
- **Aviso de atraso**: "Fonte: DataJud — pode haver atraso em relação ao tribunal".
- **Badge** quando a última coleta falhou / acompanhamento auto-pausado.
- **Ação "Coletar agora"** (quem? DP-F).
- Nenhuma informação de notificação aqui (é da fase seguinte).

---

## 15. Informações preparadas para Notificações (ponto 19)

- **`process_change_events`** com `event_type` estável, `movement_id`, `occurred_at`,
  `process_id`, `space_id` e `payload` com categoria + trecho da descrição — suficiente para
  a Fase de Notificações renderizar a mensagem.
- **`is_first_sync`** nas movimentações ⇒ a Fase de Notificações nunca dispara para o
  histórico retroativo (RN11).
- **`content_hash`** reaproveitável como base do `notification_deliveries.dedupe_key`.
- **Não** se define aqui: destinatários, regras, templates, canal — tudo isso é
  `notification_rules` + `assigned_user_id` + `process_clients` na Fase de Notificações.

---

## 16. O que pertence a esta fase × fases posteriores (ponto 20)

| Item | Fase |
|---|---|
| Tabelas novas + RLS + helpers | **Acompanhamento-A** |
| `@juriflow/movement-normalizer` + detector (puros) | **Acompanhamento-A** |
| `SourceRegistry` no runtime + `MockSourceAdapter` | **Acompanhamento-A** |
| Scheduler (pg_cron), dispatcher, retry, `job_runs`, locks | **Acompanhamento-A** |
| RPC de coleta manual + tela de detalhe (movimentações + situação) | **Acompanhamento-A** |
| **Adapter DataJud** + taxonomia de movimentos + runtime DataJud | **Acompanhamento-B** |
| `courts` completo, `court_aliases`, categorias (estrutural DataJud) | **Fase 4** (pode vir antes/junto da B) |
| `services/collector-worker` + **Adapter TJAM/Projudi** + credenciais Vault | **Acompanhamento-C** (gated por DP-A, DP-C, PP-12) |
| Motor de Regras, templates, entregas, WAHA | **Fase de Notificações** |
| Aniversário de clientes, planos/limites | fases próprias |

---

## 17. Decisões pendentes

`DP-A` .. `DP-S` abaixo. As que **bloqueiam a primeira migration** estão na seção 21.

| ID | Tema | Proposta (não decidida) |
|---|---|---|
| DP-A | Runtime da coleta / hospedagem do `collector-worker`; DataJud em Edge Function ou worker (era DP-02) | Worker Node em contêiner; DataJud pode rodar em Edge Function |
| DP-B | 1 ou N `process_tracking_configs` por processo (multi-fonte simultânea) (era DP-23) | N, com unique `(process_id, source_kind)` |
| DP-C | Credenciais de fontes autenticadas: institucional (por espaço) ou por advogado; onde armazenar (era DP-13) | Vault; `credentials_ref` na config |
| DP-D | Base 08:00 diária: fuso (UTC / America/Manaus / por espaço)? Frequência fixa ou configurável por config? Event-driven depois? (era DP-14) | Diário 08:00, fuso a definir; frequência configurável por config |
| DP-E | Armazenamento do RAW: tabela `jsonb` vs bucket de Storage | Tabela para o MVP; migrar a Storage se crescer |
| DP-F | Quem configura acompanhamento e dispara coleta manual (era PP-06) | ADMIN gerencia fonte/params; COLABORADOR responsável liga/desliga e coleta manual |
| DP-G | Retenção de RAW payloads e `collection_runs` (LGPD) | Definir prazos (ex.: RAW 180 dias, runs 1 ano) |
| DP-H | `process_movements` / `process_change_events`: ex-responsável perde acesso após transferência? Responsável lê `process_change_events`? | Sim, perde (consistente com Fase 3); eventos: ADMIN + responsável |
| DP-I | Feed de eventos: tabela `process_change_events` vs fila (pgmq) (era DP-32) | Tabela para o MVP; interface permite trocar |
| DP-J | Auto-pausa após M falhas consecutivas — sim/não e M | Sim, M = 5, reativação manual |
| DP-K | Janela de sobreposição do fetch incremental | 7 dias |
| DP-L | Movimentação com campo obrigatório ausente: pular vs. gravar com `needs_review` | Gravar com `needs_review` |
| DP-M | Taxonomia de movimentos (`movement_categories`) / `court_aliases`: semear nesta fase ou na Fase 4 | Mínimo agora, catálogo completo na Fase 4 |
| DP-N | Estratégia de fonte por tribunal: tabela `court_tracking_strategies` gerida pelo SUPER_ADMIN? ADMIN pode sobrepor por processo? | Sim tabela global; ADMIN só habilita/desabilita por processo |
| DP-P | Critério de "movimentação nova/igual" (regra de normalização do `content_hash`) e "alteração relevante" para notificar (era DP-03 / PP-13) | Normalização proposta em §9; detector emite tudo, filtro fica na Fase de Notificações |
| DP-Q | Política de backoff/tentativas | 5m/15m/1h/3h/6h, máx 5 |
| DP-R | Timeouts por fonte e limites de cota (DataJud tem quota) | 30s HTTP / 120s scraper; cota configurável em `court_tracking_strategies.params` |
| DP-S | Acesso do worker ao banco: `service_role` vs role dedicada com grants mínimos | Role dedicada, se viável |

---

## 18. Riscos

| ID | Risco | Mitigação |
|---|---|---|
| RT-A | **Atraso do DataJud** vs. expectativa de tempo real do usuário | UI deixa a fonte e o atraso explícitos; TJAM/Projudi para casos que exigem atualidade |
| RT-B | Fragilidade / ToS do scraping TJAM/Projudi (mudança de HTML, captcha) | Adapter isolado (RN10); testes de contrato com fixtures; erro contido em `collection_runs`; aval jurídico PP-12 |
| RT-C | Edge Function não faz navegador headless (era RT-23) | `collector-worker` dedicado (DP-A) |
| RT-D | Volume e PII dos RAW payloads (LGPD) | Retenção definida (DP-G); RLS igual às movimentações; considerar Storage |
| RT-E | Mesma movimentação com textos diferentes entre fontes ⇒ duplicidade (era RT-06) | Regra de normalização estável do `content_hash` (DP-P); `source_movement_id` quando houver |
| RT-F | Histórico gigante em processo antigo (era RT-07) | Paginação com cap + runs `partial` incrementais; índices desde o início |
| RT-G | Credencial expira / captcha no Projudi | Classificação `auth_failed` sem retry + alerta ADMIN; runbook |
| RT-H | Bugs de fuso/janela no agendamento (era DP-14) | Fuso único explícito (DP-D); testes do cálculo de `next_run_at` |
| RT-I | `state_hash` instável ⇒ eventos falsos ou perdidos | Normalização determinística e testada (Vitest); `state_hash` só sobre o conjunto de `content_hash` |
| RT-J | Cota do DataJud estourada por sweep concentrado | Jitter no `next_run_at`; throttling por fonte; respeitar `Retry-After` |
| RT-K | Não alterar `processes` ⇒ estado de acompanhamento vira join | Índices em `process_tracking_state (process_id, source_kind)` e `process_tracking_configs (enabled, next_run_at)` |
| RT-L | Acoplamento acidental "fonte específica" vazando pro núcleo (era RT-26) | Lint de arquitetura: `packages/domain` e `movement-normalizer` proibidos de importar adapters |

---

## 19. Dependências

- **Fase 3 (concluída):** `processes`, `courts`, `app.can_read_process`, `audit_logs`,
  `app.write_audit_log`, padrão de RLS/triggers.
- **`packages/collectors-core` (existe):** `ProcessDataSource`, `SourceRegistry`, `RawMovement`,
  `SourceKind`, erros. Nada muda no contrato nesta fase.
- **Novo:** `packages/movement-normalizer` (puro).
- **Acesso à API Pública do DataJud** (chave) — só na sub-fase B.
- **Decisão de runtime/hosting (DP-A)** — só na sub-fase C (worker).
- **Fase 4 (Tribunais/DataJud estrutural):** fornece `court_aliases` e a taxonomia completa
  de movimentos. **Ordenação:** ou a Fase 4 vem antes da Acompanhamento-B, ou a B semeia uma
  taxonomia mínima e a Fase 4 completa depois (DP-M).
- **`pg_cron` + `pg_net`** habilitados no projeto Supabase (extensões) — para o scheduler.
- **Supabase Vault** — para credenciais de fontes autenticadas (sub-fase C).

---

## 20. Ordem recomendada das próximas etapas

1. **Você aprova este documento** e responde as decisões da seção 21.
2. **Acompanhamento-A** — modelo de dados (migrations aditivas) + RLS + helpers +
   `movement-normalizer` + detector + `SourceRegistry`/`MockSourceAdapter` + scheduler +
   RPC de coleta manual + tela de detalhe + testes. **Sem fonte real, sem worker.**
3. **Fase 4 — Tribunais/DataJud estrutural** (ou ao menos a taxonomia mínima de movimentos),
   se ainda não feita.
4. **Acompanhamento-B** — Adapter DataJud (HTTP) + runtime (Edge Function/worker) + wiring no
   scheduler + testes de contrato com fixtures.
5. **Acompanhamento-C** — `collector-worker` + Adapter TJAM/Projudi + credenciais Vault.
   Bloqueada por DP-A, DP-C, PP-12.
6. **Fase de Notificações** — Motor de Regras consumindo `process_change_events` + templates +
   entregas + WAHA.

---

## 21. Decisões que preciso de você ANTES de qualquer migration

Estas definem o **schema** e as **políticas** das tabelas novas — precisam estar fechadas
antes da primeira migration da Acompanhamento-A:

| # | Pergunta | Recomendação |
|---|---|---|
| **1 (DP-B)** | Um processo pode ser acompanhado por **várias fontes ao mesmo tempo**? (define se `process_tracking_configs` é `unique(process_id)` ou `unique(process_id, source_kind)`) | **Sim, N fontes** — `unique(process_id, source_kind)` |
| **2 (DP-N)** | A fonte de cada processo é **derivada do tribunal** (tabela global `court_tracking_strategies` gerida pelo SUPER_ADMIN) e o ADMIN só **habilita/desabilita** por processo? Ou o ADMIN escolhe a fonte livremente por processo? | Derivada do tribunal + ADMIN só habilita/desabilita |
| **3 (DP-F)** | Quem **liga/desliga** o acompanhamento e quem pode **"coletar agora"**: ADMIN + COLABORADOR responsável, ou só ADMIN? E trocar fonte/params = só ADMIN? | ADMIN + responsável ligam/desligam e coletam manual; fonte/params/credenciais = só ADMIN |
| **4 (DP-H)** | As **movimentações** (`process_movements`) e o **feed de eventos** seguem exatamente a regra de acesso da Fase 3 (ADMIN do espaço **ou** responsável atual; ex-responsável perde acesso após transferência; SUPER_ADMIN sem acesso)? | **Sim** — reusar `app.can_read_process` |
| **5 (DP-E + DP-G)** | O **payload bruto** fica numa **tabela `jsonb`** ou num **bucket de Storage**? E qual a **retenção** de RAW e de `collection_runs` (LGPD)? | Tabela `jsonb` no MVP; RAW ~180 dias, `collection_runs` ~1 ano (a confirmar) |
| **6 (DP-I)** | Feed de eventos como **tabela `process_change_events`** ou **fila (pgmq)**? | Tabela |
| **7 (DP-D)** | **Fuso** da rotina 08:00 (UTC / `America/Manaus` / por espaço) e se a **frequência** é fixa diária ou **configurável por config**? | `America/Manaus`? (a confirmar); frequência configurável por config, default diário |
| **8 (DP-M)** | A **taxonomia de movimentos** (`movement_categories`) e `court_aliases` entram **nesta fase** (mínimo) ou só na **Fase 4**? Isso muda a ordem das próximas etapas. | Mínimo nesta fase; catálogo completo na Fase 4 |
| **9 (DP-P)** | Confirmar que o **detector emite todos** os `new_movement`/`movement_amended` e o **filtro de "relevância" para notificação fica na Fase de Notificações** (não no detector)? | **Sim** |
| **10 (DP-J)** | **Auto-pausar** o acompanhamento de uma fonte após **M falhas consecutivas** (com alerta ao ADMIN e reativação manual)? Valor de **M**? | Sim, M = 5 |
| **11 (DP-A)** | Confirmar a direção: **`collector-worker` (contêiner Node)** para fontes pesadas/scraping; **DataJud** pode rodar em **Edge Function**. (Não bloqueia a Acompanhamento-A, mas bloqueia B/C.) | Confirmar a direção; hosting depois |

Decisões que **não** bloqueiam a primeira migration (podem ser fechadas na sub-fase
correspondente): DP-C, DP-K, DP-L, DP-Q, DP-R, DP-S, PP-12.

---

## 22. Regra fundamental

Nada de novo em regra de negócio. Onde algo não está definido pelas decisões vigentes do
JuriFlow, está marcado como `DP-*` e **aguarda sua decisão**. Comportamento default proposto
é sempre o mais conservador (não notifica retroativo, não apaga histórico, emite tudo e filtra
depois, falha de coleta não altera o processo).

**Aguardo sua aprovação e as respostas da seção 21.** Nenhum código ou migration será criado
até então. Nada da Fase 3 será alterado.
