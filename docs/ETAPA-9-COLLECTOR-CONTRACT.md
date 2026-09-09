# JuriFlow · Etapa 9 — Contrato do Collector (preparação para o robô Playwright da Etapa 10)

> **Escopo:** redução para MVP. Esta etapa **não** automatiza navegador nem consulta
> tribunal. Ela responde *"onde o robô Playwright entra no sistema e qual contrato ele
> precisa cumprir?"* e deixa a estrutura mínima pronta para a Etapa 10
> (Playwright + Microsoft Edge). ("scraping" e "robô Playwright" são a mesma coisa aqui.)

## Decisões (aprovadas / delegadas pelo responsável)

| Tema | Decisão | Origem |
|---|---|---|
| Runtime do collector | **TypeScript** — pacote novo `@juriflow/adapter-playwright`, como o `adapter-datajud`. O `go/worker` fica intacto no repo para uma futura coleta distribuída, fora do MVP. | responsável delegou; recomendação registrada |
| Contrato | **Reusar `ProcessDataSource`** (`@juriflow/collectors-core`) — já tem entrada (CNJ+contexto), saída (movimentações), estados (found/not_found/erro), `SourceRegistry` e mock. Nada recriado. | "não recrie o que já existe" |
| Fonte | **Playwright + Edge** é o caminho do MVP. **DataJud fica adiado** — integra depois (já implementa o mesmo `ProcessDataSource`). | responsável |
| Nome do `source_kind` do skeleton | `'projudi_tjam'` (a fonte concreta do MVP; já em `KnownSourceKind` e nos labels do frontend). Configurável por opção (`kind`). | decisão pequena/reversível |
| Nome do pacote | `@juriflow/adapter-playwright` (o responsável usa "Playwright / robozinho" como vocabulário). Classe: `PlaywrightCollector`. | responsável |
| **Pipeline** (`runCollection` orquestrado) | **Fora do MVP — adiado por último.** A Etapa 9 só define o contrato do collector; não decide onde/como o `runCollection` roda. O teste que exercita `runCollection` é só prova de encaixe, não infraestrutura. | responsável |
| Como o robô escolhe a URL/fluxo do tribunal | **URL e passo-a-passo do TJAM ficam FIXOS na config do robô (Etapa 10).** O robô não consulta a tabela `courts`. O campo `courtId` continua no contrato (`BrowserCaseQuery`) para quando entrarem outros tribunais, mas o robô do MVP o ignora (ou só confere que é o do TJAM). | responsável (opção A) |

## Arquitetura

```
Application
   ↓
ProcessDataSource            @juriflow/collectors-core        (contrato — já existia)
   ↓
PlaywrightCollector             @juriflow/adapter-playwright        (NOVO — Etapa 9, skeleton)
   ↓
BrowserCaseRunner  (porta)   @juriflow/adapter-playwright        (NOVO — Etapa 9, interface)
   ↓
Playwright + Microsoft Edge  @juriflow/adapter-playwright        (Etapa 10 — a implementar)
   ↓
fonte externa (tribunal)
```

- O domínio e o `PlaywrightCollector` **só conhecem `BrowserCaseRunner`**. Navegador,
  seletores, carregamento de página e Playwright **não vazam** dessa porta.
- Erros de consulta (indisponível, timeout, HTML inesperado, Edge ausente, bloqueio)
  são **lançados** como `CollectionError` do `@juriflow/collector-engine` — nenhuma
  taxonomia nova.

## Contrato final do collector

### `ProcessDataSource` (reutilizado, `@juriflow/collectors-core`)

```ts
interface ProcessDataSource {
  readonly kind: SourceKind;
  canHandle(target: SourceTarget): boolean;          // PlaywrightCollector: exige cnjNumber
  fetch(input: SourceFetchInput): Promise<SourceFetchResult>;
}
// SourceFetchInput  = { target: { cnjNumber, courtId, params? }, since?, requestId? }
// SourceFetchResult = { sourceKind, collectedAt, movements: RawMovement[], partial? }
// RawMovement       = { sourceKind, sourceMovementId: string|null, occurredAt: string|null,
//                       description, raw }
```

### `BrowserCaseRunner` (novo — a porta do scraper, `@juriflow/adapter-playwright`)

```ts
interface BrowserCaseQuery {
  cnjNumber: string;          // com ou sem pontuação; a impl normaliza
  courtId: string;            // a impl escolhe URL/fluxo por ele
  params?: Record<string, unknown>;
  requestId?: string;
}
interface BrowserMovement {
  sourceMovementId: string | null;   // id estável da fonte quando houver
  occurredAt: string | null;         // data/hora como veio da página
  description: string;               // título/evento
  raw?: unknown;                     // extra opcional p/ auditoria
}
type BrowserCaseOutcome =
  | { status: 'found'; movements: readonly BrowserMovement[]; partial?: boolean }
  | { status: 'not_found' };
interface BrowserCaseRunner {
  run(query: BrowserCaseQuery): Promise<BrowserCaseOutcome>;  // erros → throw CollectionError
}
```

### Resultado da coleta — 3 estados (reutilizados)

| Estado | Como o `PlaywrightCollector` expressa |
|---|---|
| **Processo encontrado** | `fetch()` resolve com `SourceFetchResult { movements, partial? }` |
| **Processo não encontrado** | `fetch()` **lança** `CollectionNotFoundError` (`code: 'not_found'`, não retriável) |
| **Erro de consulta** | o `CollectionError` lançado pelo `BrowserCaseRunner` **sobe intacto** (`unavailable` / `timeout` / `parse_error` / `rate_limited` / `auth_failed` / `unknown`) |

## Movimentações — coletar → persistir → comparar → detectar nova

- **Coletar / mapear:** `BrowserMovement` → `RawMovement` (feito pelo `PlaywrightCollector`).
- **Persistir / comparar / detectar:** **já implementado** no `@juriflow/collector-engine`
  (`runCollection` → `detectChanges` → `MovementRecord`/`EventRecord`; RPCs
  `submit_collection_result` para gravar). A Etapa 9 **prova** esse encaixe num teste
  (`runCollection` consumindo o `PlaywrightCollector` com runner falso, sem site).
- **Identificador para comparação:**
  - **Preferencial:** `sourceMovementId` quando a fonte fornecer (usado só para refinar
    "movimentação alterada").
  - **Sempre (fallback por conteúdo, já implementado):** `content_hash` =
    `sha256(isoDay(occurredAt) + categoria/label normalizada + descrição normalizada +
    sourceMovementId||'' + sourceKind)`. É o que dedupe e detecta movimentação nova
    mesmo sem id da fonte. **Nenhuma solução nova foi inventada.**
  - **Dúvida a registrar (§5):** se, para uma fonte específica, `content_hash` colidir
    (duas movimentações no mesmo dia, mesmo título e mesma descrição), a estratégia
    simples proposta é acrescentar a **ordem/sequência da página** ao `raw` e, se
    necessário na Etapa 11, ao hash — **decisão para a Etapa 11**, não agora.

## Arquivos

### Criados
| Arquivo | Responsabilidade |
|---|---|
| `packages/adapter-playwright/package.json` · `tsconfig.json` | pacote workspace mínimo (deps: `collectors-core`, `collector-engine`; **sem** Playwright) |
| `packages/adapter-playwright/src/browser-runner.ts` | **porta** `BrowserCaseRunner` + tipos `BrowserCaseQuery` / `BrowserMovement` / `BrowserCaseOutcome`. JSDoc com as regras do Edge para a Etapa 10. |
| `packages/adapter-playwright/src/playwright-collector.ts` | `PlaywrightCollector implements ProcessDataSource` — exige CNJ, chama o runner, mapeia p/ `RawMovement`, `not_found` → `CollectionNotFoundError`. Sem navegador/seletores/Playwright. |
| `packages/adapter-playwright/src/index.ts` | barrel |
| `packages/adapter-playwright/src/testing/index.ts` | `FakeBrowserCaseRunner` + `fakeMovement()` — testar sem navegador nem site |
| `packages/adapter-playwright/src/playwright-collector.spec.ts` | 8 testes de contrato |
| `docs/ETAPA-9-COLLECTOR-CONTRACT.md` | este documento |

### Alterados
| Arquivo | Mudança | Motivo |
|---|---|---|
| `tsconfig.json` (raiz) | +1 project reference `./packages/adapter-playwright` | build da monorepo |
| `vitest.config.ts` | +2 alias (`@juriflow/adapter-playwright` e `/testing`) | rodar testes contra o fonte |
| `package-lock.json` | link do novo workspace | `npm install` |

**Não tocado:** `go/**`, `supabase/**`, `apps/web/**`, demais `packages/**`, `scripts/**`.

## Testes executados

| Suíte | Antes | Depois | Resultado |
|---|---|---|---|
| `npx tsc -b` (pacotes) | OK | OK | compila |
| `npx vitest run` | 13 arquivos / 114 testes | **14 / 122** (+8) | todos passam |
| `npx eslint packages/adapter-playwright` | — | limpo | sem warnings |
| `cd go && go build ./... && go test ./...` | ok | **ok** (inalterado) | `collectorengine` + `worker` |
| `git diff --check` | limpo | limpo | — |

Os 8 testes do `PlaywrightCollector`: `kind` default/override · `canHandle` exige CNJ ·
encontrado → mapeia `RawMovement` + repassa a consulta · `partial` propagado ·
não encontrado → `CollectionNotFoundError` · erro de consulta sobe intacto ·
alvo sem CNJ → resultado vazio · **`runCollection` consome o collector** (gera
`content_hash` + `state_hash`, sem site).

## Pronto para a Etapa 10

Implementar `BrowserCaseRunner` com **Playwright + Microsoft Edge**:

> `browserType.launch({ channel: 'msedge' })` — navegador **Microsoft Edge**;
> **não** Chromium/Firefox/WebKit; **sem** fallback silencioso para Chromium;
> se o Edge não estiver disponível, **erro explícito**; **verificar** a
> disponibilidade do Edge em runtime.

O que a Etapa 10 faz: (1) confirma Edge disponível; (2) Playwright inicia o Edge;
(3) navega; (4) interage com a página; (5) captura os dados; (6) extrai as
movimentações — devolvendo `BrowserCaseOutcome` no contrato acima. `playwright` só
entra como dependência **do `@juriflow/adapter-playwright` na Etapa 10**.

A URL do PROJUDI do TJAM e o passo-a-passo ficam **fixos na configuração do robô**
(decisão A). O robô recebe `courtId` no `BrowserCaseQuery` mas, no MVP, não o usa
para nada além de (opcionalmente) confirmar que é o do TJAM — nenhuma consulta a
banco.

Base já existente reaproveitada por essa implementação: `scripts/tjam-projudi-scraper.mjs`
(robô Playwright/Edge que já extrai as movimentações de um processo TJAM — vira a
implementação concreta do `BrowserCaseRunner`).

## Deliberadamente fora (adiado)

Implementação Playwright/browser automation (Etapa 10) · **pipeline / orquestração do
`runCollection` (adiado — MVP sem pipeline; decisão por último)** · scheduler/cron ·
Redis/RabbitMQ/Kafka · Kubernetes · múltiplos workers · múltiplos tribunais ·
consulta a `courts` pelo robô · WhatsApp/notificações · **DataJud** (integra depois) ·
PROJUDI/e-SAJ como implementação · autenticação em tribunais · documentos/PDFs/partes/
advogados · IA/classificação avançada de movimentos · HA/retry sofisticado/circuit
breaker/observabilidade avançada · comparação de movimentações implementada (Etapa 11 —
a estrutura já permite).

## Decisões desta rodada (o responsável pediu "faça o melhor pro projeto")

- **Nome do pacote:** `@juriflow/adapter-playwright` (classe `PlaywrightCollector`).
- **Pipeline (`runCollection` orquestrado):** adiado — MVP sem pipeline.
- **URL/fluxo do tribunal:** fixos na config do robô na Etapa 10 (opção A); sem consulta a `courts`.
- **`source_kind` default:** **`'projudi_tjam'`** — a fonte concreta do MVP; já em
  `KnownSourceKind` e nos labels do frontend. Continua configurável por `kind`.

Nenhuma dúvida em aberto para a Etapa 9.
