# JuriFlow · Etapa 11 — Persistência ponta-a-ponta da coleta real

> **Escopo (confirmado):** mínimo. Plugar o coletor **real** do PROJUDI/TJAM
> (Playwright + Edge, Etapas 9–10) no `runCollectorTick` e **provar que a coleta
> real grava movimentações** em `process_movements` e gera `process_change_events`.
> Caminho **TypeScript** (o `go/worker` fica intacto). **Sem** worker de produção,
> sem fila distribuída, sem scheduler novo.

## Relatório (10 pontos)

### 1. O que já existia (e foi reaproveitado)

A camada de persistência + detecção de movimentação nova **já estava pronta** —
Etapa 11 não criou schema nem RPC:

| Peça | Onde | O que faz |
|---|---|---|
| `process_movements` | migração 0019 | histórico canônico append-only; dedup por `unique (process_id, source_kind, content_hash)` |
| `collection_runs` / `collection_raw_payloads` | 0018 | log de execução + payload bruto |
| `process_change_events` | 0020 | feed do detector (`new_movement` / `movement_amended` / `first_sync_completed`) |
| `process_tracking_state` | 0017 | `state_hash`, `first_sync_done`, `last_movement_occurred_at` |
| `claim_pending_collection_run()` / `submit_collection_result()` / `submit_collection_failure()` | 0021 | contrato de runtime (service_role) |
| `runCollection()` | `@juriflow/collector-engine` | calcula `content_hash`, compara com `known[]`, detecta novas × revisadas, emite eventos, `stateHash` |
| `runCollectorTick()` | `@juriflow/collector-engine/tick.ts` | `claim → runCollection → submit` |

O que **faltava**: o `runCollectorTick` só era exercitado contra o
`MockSourceAdapter` (via `scripts/collector-tick.mjs`). Nenhuma fonte real
estava registrada no caminho de persistência.

### 2. O que foi implementado

| Arquivo | Papel |
|---|---|
| `packages/adapter-playwright/src/source-registry.ts` | `registerTjamProjudiSource(registry, opts?)` — registra `projudi_tjam` → `PlaywrightCollector` + `TjamProjudiEdgeRunner`. Aceita `runner` injetado (testes) ou cria o runner real do Edge. Só composição. |
| `scripts/collector-tick-real.mjs` | Tick **real**: `SourceRegistry` com a fonte PROJUDI + resolvedor de categorias → `runCollectorTick` contra o Supabase. Variáveis: `JURIFLOW_TICK_HEADLESS`, `JURIFLOW_TICK_TIMEOUT_MS`, `JURIFLOW_EDGE_PROFILE_DIR`, `JURIFLOW_TICK_MAX`. |
| `package.json` | script `collector:tick:real`. |
| `packages/adapter-playwright/src/index.ts` | exporta `source-registry`. |

Nada foi tocado em `packages/collector-engine`, nas migrações, nas RPCs ou no
`go/`.

### 3. Arquivos criados / alterados

**Criados**
- `packages/adapter-playwright/src/source-registry.ts`
- `packages/adapter-playwright/src/source-registry.spec.ts` — 5 testes automatizados (sem rede, sem Supabase).
- `packages/adapter-playwright/src/projudi-e2e.integration.spec.ts` — 2 testes **E2E reais**, atrás de `JURIFLOW_TEST_PROJUDI_E2E=1`.
- `scripts/collector-tick-real.mjs`
- `docs/ETAPA-11-PERSISTENCIA-E2E.md`

**Alterados**
- `packages/adapter-playwright/src/index.ts` — export.
- `packages/adapter-playwright/package.json` — devDependency `@supabase/supabase-js` (só o teste E2E usa).
- `package.json` — script `collector:tick:real`.
- `package-lock.json`.

### 4. Como o coletor real entra no pipeline

```
pg_cron / collect_process_now  ──insere──►  collection_runs (status 'pending')
                                                    │
                    node scripts/collector-tick-real.mjs
                                                    │
        claim_pending_collection_run()  ──►  { run_id, cnj, court_id, is_first_sync,
                                                since, known[], state_hash_before }
                                                    │
   runCollectorTick → SourceRegistry.create('projudi_tjam')
                    → PlaywrightCollector.fetch()
                    → TjamProjudiEdgeRunner.run()   [Edge abre → PROJUDI/TJAM → fecha]
                    → runCollection()  (content_hash, detecção, stateHash, eventos)
                                                    │
        submit_collection_result(run_id, {movements, events, state_hash, counts, ...})
                                                    │
        process_movements  +  process_change_events  +  process_tracking_state
        +  collection_raw_payloads  +  collection_runs (status 'success', counts)
```

Se a fonte falhar (`not_found`, WAF, timeout, Edge ausente), `runCollectorTick`
chama `submit_collection_failure` → a RPC aplica backoff/retry/auto-pausa que
**já existia**. A Etapa 11 não adicionou nenhuma política de retry.

### 5. Fluxo real executado (teste E2E)

`packages/adapter-playwright/src/projudi-e2e.integration.spec.ts`, contra Supabase
local (`supabase start`, portas 55321/55322) e Edge real:

1. **Seed** (via `@supabase/supabase-js` com `service_role`): usuário
   (`auth.admin.createUser`), space + membership ADMIN, court TJAM,
   `court_tracking_strategies (projudi_tjam, requires_cnj)`, processo com o CNJ
   de teste, `process_tracking_configs (projudi_tjam, enabled)`.
2. Enfileira `collection_runs (status 'pending', trigger 'manual')`.
3. `runCollectorTick({ rpc: <supabase>, registry: <projudi real>, resolveCategory })`.
4. **Assert 1ª coleta:** `collection_runs.status = 'success'`,
   `movements_fetched ≥ 1`, `movements_new ≥ 1`, `state_hash_after` com 64 hex;
   `process_movements` ≥ 1 linha (todas `source_kind = 'projudi_tjam'`,
   `content_hash` 64 hex, `is_first_sync = true`, `source_movement_id` numérico
   = Seq do PROJUDI, `raw` presente, **sem** "Movimentado por");
   `process_tracking_state.first_sync_done = true` + `state_hash` +
   `last_movement_occurred_at`; ≥ 1 `process_change_events` do tipo
   `first_sync_completed`; 1 `collection_raw_payloads` para a run.
5. **Assert 2ª coleta** (nova run pendente, agora `is_first_sync = false`,
   `known[]` populado pela RPC): `status = 'success'`, `movements_new = 0`,
   contagem de `process_movements` **inalterada** (dedup por `content_hash`),
   nenhum `process_change_events` novo.
6. **Cleanup:** apaga o space (cascateia tudo) + court/estratégia + usuário.

### 6. Exemplo de resultado real

E2E executado em 2026-09-08 contra Supabase local + Edge, CNJ
`0280181-52.2025.8.04.1000`:

```
[E2E PROJUDI] run=88843514-191a-40de-936b-ffdad1b357f7 status=success
              fetched=70 new=70; process_movements=70; primeira:
{
  "source_movement_id": "1",
  "occurred_at": "2025-10-12T07:40:12+00:00",
  "description": "JUNTADA DE PETIÇÃO DE INICIAL",
  "content_hash": "a7b724fc008477453f71e5ed40b4b5020797d504a49a0084f43ec8f46f068330"
}

 ✓ primeira coleta real: grava movimentações, estado e evento de 1ª sincronização  8217ms
 ✓ segunda coleta real: deduplica e o detector reporta zero movimentações novas    8326ms
```

- **70 linhas** gravadas em `process_movements` (`source_kind = 'projudi_tjam'`,
  todas com `content_hash`, `is_first_sync = true`).
- `collection_runs`: `status = 'success'`, `movements_fetched = 70`,
  `movements_new = 70`, `state_hash_after` preenchido.
- `process_tracking_state`: `first_sync_done = true`, `state_hash` +
  `last_movement_occurred_at` preenchidos.
- `process_change_events`: evento `first_sync_completed` (histórico retroativo
  **não** vira `new_movement` — `is_first_sync` marca isso).
- `collection_raw_payloads`: 1 linha para a run.
- **2ª coleta:** `status = 'success'`, `movements_new = 0`, `process_movements`
  seguiu com 70 linhas (dedup por `content_hash`), nenhum evento novo.

### 7. Testes executados

| Suíte | Depende de Supabase/rede? | O que prova |
|---|---|---|
| `source-registry.spec.ts` (5) | Não | registro de `projudi_tjam`; `kind` customizado; `claim → runCollection → submit_collection_result` com RPC fake + `FakeBrowserCaseRunner` (movimentações com `content_hash`, `is_first_sync`, `state_hash`); **detecção de movimentação nova** numa 2ª coleta com `known[]` (`counts.new = 1`, evento `new_movement`); `not_found` → `submit_collection_failure` com `error_code = 'not_found'` |
| `projudi-e2e.integration.spec.ts` (2) | **Sim** — Supabase local + Edge + PROJUDI | o fluxo do §5 |
| Regressão `npx vitest run` | — | **134 passed / 4 skipped** (os 4 reais ficam skipped sem as env vars) |
| `npx tsc -b` | — | OK |
| `npx eslint .` | — | OK |
| `go build ./... && go test -count=1 ./...` | — | OK (`collectorengine`, `worker`) |

Comando do E2E:
`JURIFLOW_TEST_PROJUDI_E2E=1 SUPABASE_URL=http://127.0.0.1:55321 SUPABASE_SERVICE_ROLE_KEY=<key> npx vitest run packages/adapter-playwright/src/projudi-e2e.integration.spec.ts`

### 8. Problemas encontrados

- **`set_process_tracking` / `collect_process_now` exigem contexto de usuário
  autenticado** (`auth.uid()` + `app.can_read_process`). O E2E roda com
  `service_role` → não pode chamar essas RPCs. Resolução: o seed insere
  `process_tracking_configs` e `collection_runs` **direto** (o `service_role`
  ignora RLS; os gatilhos de INSERT resolvem estratégia/space). As RPCs de
  runtime (`claim`/`submit`) continuam sendo exercitadas de verdade.
- **`@supabase/supabase-js` não era dependência do pacote** — adicionado como
  `devDependency` de `@juriflow/adapter-playwright` (só o spec E2E importa).
- **Detecção positiva de "movimentação nova" não é determinística com fonte
  real** (o PROJUDI devolve sempre o mesmo conjunto). O E2E prova o lado
  negativo (2ª coleta = 0 novas, sem evento). O lado positivo é coberto
  deterministicamente pelo `source-registry.spec.ts` (2ª coleta com `known[]` +
  uma Seq nova → `counts.new = 1` + `new_movement`) e pelos testes unitários de
  `detectChanges`.

### 9. Pendências / fora de escopo (deliberado)

- **Worker de produção** — loop de longa duração, lifecycle do Edge entre runs,
  encerramento por sinal, observabilidade. Não feito (escopo mínimo).
- **`headless: false` obrigatório** — o tick real abre uma janela do Edge. Onde
  isso roda em produção (máquina com display / display virtual + IP residencial)
  segue em aberto desde a Etapa 10.
- **Perfil persistente do Edge** — o E2E reusa `.cache/projudi-edge-it-profile`
  (fora do versionamento). Estratégia de "aquecimento" da sessão do F5 em
  produção é decisão de infra.
- **Retry/backoff/auto-pausa** — já existem nas RPCs; não revisados aqui.
- **Categorização de movimentos do PROJUDI** — o PROJUDI não traz código TPU; as
  movimentações entram sem `category_code` (campo opcional). Mapeamento fica
  para a Fase 4 (taxonomia).
- **`go test -race`** — segue não executável nesta máquina (sem cgo/gcc).
- **Frontend** — nenhuma tela nova; o painel de acompanhamento já lê
  `process_movements` / `process_change_events` via RLS.

### 10. Decisões que precisam de aprovação

Nada de arquitetura nova foi decidido — Etapa 11 só registrou a fonte real no
caminho que já existia. Pontos para o seu aval antes de seguir:

1. **`scripts/collector-tick-real.mjs` como ponto de entrada** — no MVP, a coleta
   real é disparada rodando esse script à mão (após `collect_process_now` ou o
   sweep). Um worker que faz isso em loop é a próxima etapa, quando você
   autorizar.
2. **Seed do E2E insere `process_tracking_configs`/`collection_runs` direto** —
   para não depender de JWT de usuário no teste. Se preferir que o E2E use um
   usuário real e as RPCs `set_process_tracking`/`collect_process_now`, dá para
   trocar (mais fiel, mais frágil).
3. **`@supabase/supabase-js` em `@juriflow/adapter-playwright`** (devDependency) —
   se preferir manter o pacote sem essa dep, movo o spec E2E para um pacote de
   testes separado ou para `scripts/`.
