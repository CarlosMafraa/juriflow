# JuriFlow · Etapa 10 — Primeiro coletor real (Playwright + Microsoft Edge → PROJUDI/TJAM)

> **Escopo:** prova técnica do MVP. Um CNJ entra, o Edge abre, a Consulta Pública do
> PROJUDI/TJAM é consultada, o processo é localizado, as movimentações são extraídas e
> devolvidas **no contrato da Etapa 9** (`BrowserCaseRunner` → `PlaywrightCollector` →
> `ProcessDataSource`). **Não** é plataforma de scraping distribuída. **Não** há
> persistência nem detecção de movimentação nova — isso é a Etapa 11.

## Relatório (10 pontos)

### 1. O que foi encontrado

- A **Consulta Pública do PROJUDI/TJAM**
  (`https://projudi-consulta.tjam.jus.br/processo/consultaPublicaNova.do?actionType=iniciar`)
  está atrás de um **F5 BIG-IP WAF** (responde `Request Rejected` para clientes
  headless / datacenter) e de um **reCAPTCHA v2 invisível** (não exibe desafio para
  sessão *headed* com IP residencial). Confirmado nas Etapas anteriores e reconfirmado
  aqui: **Edge headed via Playwright passa sem captcha**; `curl`/headless é bloqueado.
- A página de resultado traz **todas as movimentações inline** (sem paginação) numa
  tabela `#idTableMovimentacoesmov1Grau1`, `tbody > tr` com 5 `<td>`:
  `[0]` expansor de documento (só quando há anexo), `[1]` Seq (inteiro, id estável da
  movimentação), `[2]` Data `DD/MM/AAAA HH:MM:SS` (horário de Manaus, UTC-4, sem
  horário de verão), `[3]` `<b>TÍTULO</b><br>complemento`, `[4]` "Movimentado por"
  (nomes de pessoas — **não coletado**).
- Cabeçalho: `<h3> Processo <em class="attention">CNJ</em> …</h3>` + `<table class="form">`
  com Classe Processual, Assunto Principal, Comarca, Nível de Sigilo.
- A página declara `<meta charset="ISO-8859-1">` mas os bytes são UTF-8; o Playwright
  entrega a string já decodificada como UTF-8.

### 2. O que foi implementado

Dividido em **duas peças** — parser puro (testável com fixtures) e driver de navegador
(testável de verdade):

| Peça | Arquivo | Responsabilidade |
|---|---|---|
| **Parser puro** | `packages/adapter-playwright/src/tjam-projudi-parser.ts` | `HTML (string) → { found / not_found / blocked / unparseable }`. Sem navegador, sem rede. Usa `linkedom` (parsing puro em Node). |
| **Driver Edge** | `packages/adapter-playwright/src/tjam-projudi-runner.ts` | `TjamProjudiEdgeRunner implements BrowserCaseRunner`. Abre o Edge (`channel: 'msedge'`), navega, preenche a busca por número único, submete, lê o HTML e delega ao parser. Converte tudo para `CollectionError`. Fecha `page`/`context`/`browser` sempre. |

O `PlaywrightCollector` (skeleton da Etapa 9) **não mudou** — já consome qualquer
`BrowserCaseRunner`. `src/index.ts` passou a exportar as duas peças novas.

### 3. Arquivos criados / alterados

**Criados**
- `packages/adapter-playwright/src/tjam-projudi-parser.ts` — parser puro.
- `packages/adapter-playwright/src/tjam-projudi-parser.spec.ts` — 7 testes (fixtures, sem rede).
- `packages/adapter-playwright/src/tjam-projudi-runner.ts` — driver Playwright + Edge.
- `packages/adapter-playwright/src/tjam-projudi-runner.integration.spec.ts` — 2 testes **reais** (Edge + PROJUDI), atrás de `JURIFLOW_TEST_PROJUDI=1`.
- `contracts/tjam/projudi/nao_encontrado.fragment.html` — fixture sintética "Nenhum registro encontrado".
- `contracts/tjam/projudi/request_rejected.fragment.html` — resposta **real verbatim** do F5 WAF (support ID mascarado).

**Alterados**
- `packages/adapter-playwright/package.json` — deps `playwright@^1.63.0`, `linkedom@^0.18.4`.
- `packages/adapter-playwright/src/index.ts` — exporta parser + runner.
- `contracts/tjam/projudi/processo_movimentacoes.skeleton.html` — enriquecido com `<form>`, cabeçalho `<h3>`/`<table class="form">` e 6 linhas de movimentação **sanitizadas** (nomes sintéticos).
- `package-lock.json` — árvore do `playwright` + `linkedom`.

### 4. Como o Edge foi configurado

- **Sempre `channel: 'msedge'`** — em `chromium.launch({ channel: 'msedge', … })` e em
  `chromium.launchPersistentContext(userDataDir, { channel: 'msedge', … })`.
- **Nenhum fallback.** Se o `launch` falhar (Edge ausente), o runner lança
  `CollectionError('unknown', 'Microsoft Edge (channel "msedge") não está disponível …
  Não há fallback para outro navegador.', retriable=false)`. Não tenta Chromium,
  Firefox nem WebKit.
- `headless: false` por default — o F5 WAF bloqueia headless (`Request Rejected`).
  `headless: true` fica só para diagnóstico.
- `args: ['--disable-blink-features=AutomationControlled']` +
  `ignoreDefaultArgs: ['--enable-automation']` — reduz sinais triviais de automação.
- `userDataDir` opcional — perfil persistente do Edge; reaproveita a sessão do F5
  entre execuções. O teste real usa `.cache/projudi-edge-it-profile`.
- Timeout por passo configurável (`timeoutMs`, default 60 s; o teste real usa 120 s).

### 5. Fluxo real executado

```
CNJ (20 díg.) ─ valida formato
  → chromium.launch/launchPersistentContext({ channel: 'msedge' })   [Edge abre]
  → page.goto(consultaPublicaNova.do?actionType=iniciar)
  → waitForSelector('#numeroProcesso')   (se não vier → checa "Request Rejected" → CollectionUnavailableError)
  → selectOption('#cbPesquisa', 'NUMPROC'); check(radio flagNumeroUnico=true); fill(#numeroProcesso, cnj)
  → click('#pesquisar')  (fallback: Enter no campo)
  → waitForSelector('#idTableMovimentacoesmov1Grau1 | #mensagemRetorno')
  → html = page.content()
  → parseTjamProjudiCasePage(html)
       found       → confere numero da página == CNJ consultado → devolve movements
       not_found   → { status: 'not_found' }
       blocked     → CollectionUnavailableError (waf | recaptcha)
       unparseable → CollectionParseError
  finally → page.close() / context.close() / browser.close()   (sempre)
```

Do lado do domínio: `PlaywrightCollector.fetch()` mapeia `BrowserMovement` → `RawMovement`
(`sourceKind`, `sourceMovementId`, `occurredAt`, `description`, `raw`); `not_found` vira
`CollectionNotFoundError`. `runCollection` consome isso e gera `content_hash` / `stateHash`.

### 6. Exemplo de resultado real

Teste real, CNJ `0280181-52.2025.8.04.1000` (processo público do TJAM), executado em
2026-09-08 (`JURIFLOW_TEST_PROJUDI=1`):

```
[IT PROJUDI] 70 movimentações; última: {
  "sourceMovementId": "1",
  "occurredAt": "2025-10-12T07:40:12.000Z",
  "description": "JUNTADA DE PETIÇÃO DE INICIAL",
  "raw": {
    "seq": 1,
    "dataRaw": "12/10/2025 03:40:12",
    "titulo": "JUNTADA DE PETIÇÃO DE INICIAL",
    "complemento": null,
    "temDocumento": false,
    "cdDocumento": null
  }
}
```

`dataRaw` `12/10/2025 03:40:12` (Manaus, UTC-4) → `occurredAt` `2025-10-12T07:40:12.000Z`.
O segundo teste real passou o mesmo processo pelo `PlaywrightCollector` + `runCollection`
e obteve `movements[0].content_hash` e `stateHash` no formato `^[0-9a-f]{64}$`.

**Nenhum dado pessoal coletado**: sem partes, advogados, documentos/PDFs, sem a coluna
"Movimentado por". Só CNJ + Seq + data + evento/título (+ complemento e flag de anexo).

### 7. Testes executados

| Suíte | Depende de fonte externa? | Resultado |
|---|---|---|
| `tjam-projudi-parser.spec.ts` (7) | Não — fixtures | ✅ |
| `playwright-collector.spec.ts` (8) | Não — `FakeBrowserCaseRunner` | ✅ |
| `tjam-projudi-runner.integration.spec.ts` (2) | **Sim — Edge + PROJUDI real** | ✅ (29 s; 70 movimentações; `content_hash`/`stateHash` ok) |
| Regressão TS — `npx vitest run` | — | ✅ **129 passed / 2 skipped** (os 2 reais ficam skipped sem a env var) |
| `npx tsc -b` | — | ✅ |
| `npx eslint .` | — | ✅ sem avisos |
| `go build ./... && go test -count=1 ./...` | — | ✅ `collectorengine`, `worker` |

Comando do teste real:
`JURIFLOW_TEST_PROJUDI=1 npx vitest run packages/adapter-playwright/src/tjam-projudi-runner.integration.spec.ts`

### 8. Problemas encontrados e resolução

- **F5 WAF x headless** — headless recebe `Request Rejected`. Resolução: `headless: false`
  por default; perfil persistente (`userDataDir`) para reusar a sessão; o parser
  reconhece a página do WAF e o runner a mapeia para `CollectionUnavailableError`.
- **`linkedom` sem `lib.dom`** — `tsconfig.base.json` tem `lib: ["ES2022"]` (sem `"dom"`).
  Resolução: tipos derivados de `ReturnType<typeof parseHTML>['document']`, sem
  referência ao `Document` global; sem seletores `:scope` (filtro manual de `children`).
- **Charset ISO-8859-1 declarado, bytes UTF-8** — o Playwright entrega a string já
  correta; o parser não redecodifica.
- **`TS2366` "function lacks ending return"** no `switch (parsed.status)` — o TS não
  reconhece o switch como exaustivo. Resolução: `throw` inalcançável após o switch.
- **Fixture "não encontrado" sem `<html>/<body>`** — `document.body` vazio no `linkedom`.
  Resolução: `clean(document.body?.textContent) || clean(document.documentElement?.textContent)`.

### 9. Pendências / fora de escopo (deliberado)

- **Etapa 11** — persistência das movimentações, detecção de movimentação nova,
  gravação em `process_movements` / `collection_runs`. **Não implementado aqui.**
- Sem retry, circuit-breaker, fila, scheduler, reaper — decisão do brief.
- `courtId` continua no contrato mas o runner do MVP usa **URL fixa do TJAM** (não
  consulta `courts`).
- Outras fontes/tribunais — cada uma implementa seu próprio `BrowserCaseRunner`.
- `go test -race` continua não executável nesta máquina (sem cgo/gcc) — limitação
  registrada desde as etapas anteriores.
- A fixture `nao_encontrado.fragment.html` é **sintética** (não houve captura real de
  um CNJ inexistente); o comportamento `not_found` real depende do texto
  "Nenhum registro encontrado" que o parser procura.

### 10. Decisões que precisam de aprovação / seguem para você

Nada foi decidido de forma arquitetural nova nesta etapa — tudo seguiu o contrato da
Etapa 9 e o brief da Etapa 10. Pontos para o seu aval antes da Etapa 11:

1. **Perfil persistente do Edge em `.cache/`** — o teste real grava um perfil do Edge
   em `.cache/projudi-edge-it-profile` (fora do controle de versão). Em produção, onde
   esse perfil vive e como é "aquecido" (primeira sessão do F5) é uma decisão de infra
   da Etapa 11+.
2. **`headless: false` obrigatório** — a coleta real precisa de janela visível. Isso
   condiciona onde o coletor roda (máquina com display / display virtual, IP
   residencial). Precisa ser considerado no desenho do worker.
3. **Complemento e flag de anexo em `raw`** — estão sendo capturados (sem PII). Se você
   não quiser nem isso no MVP, corto para só `data` + `evento`.
4. **CNJ único por consulta** — o formulário aceita um CNJ por vez; lote é feito pelo
   chamador, uma execução do runner por processo.
