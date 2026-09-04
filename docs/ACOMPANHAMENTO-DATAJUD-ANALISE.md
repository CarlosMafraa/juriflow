# JuriFlow — Acompanhamento-B: integração real com o DataJud (Análise técnica)

> **Somente análise.** Nenhuma migration, adapter, Edge Function, alteração de RLS, de
> `processes`/`courts` ou do comportamento da Acompanhamento-A. Nenhum commit. Este
> documento é para **aprovação** antes de qualquer implementação.
> **Data:** 2026-09-03

---

## Status de implementação (Acompanhamento-B — 2026-09-04)

Implementado conforme DJ-1..DJ-12. Registros explícitos de decisões tomadas na entrega:

- **Taxonomia (DJ-4 / RT-DJ-2):** a Acompanhamento-B entra com uma **taxonomia inicial
  mínima e segura** (`movement_categories` = 16 códigos de `0016` + 4 de `0022`). Códigos
  do DataJud fora dessa lista são persistidos com `category_code = null` e
  `needs_review = true` — nunca descartados nem "adivinhados". A expansão para o
  subconjunto curado (~200–400 códigos) e depois a TPU completa será feita a partir do
  **export oficial do CNJ/SGT**, na Fase 4. Não há dívida técnica escondida: o
  comportamento é degradação graciosa, visível na fila de "revisar".
- **0 hits / segredo de justiça (DJ-8 / RT-DJ-8, F-1):** `200` com `hits.total.value == 0`
  é **resultado vazio e sucesso** (o adapter devolve `SourceFetchResult` sem movimentos;
  não chama `submit_collection_failure`, não conta para a auto-pausa). Consequência aceita:
  se um processo sigiloso passar a ficar disponível **depois** da 1ª sincronização, seu
  histórico será interpretado pelas regras normais de uma coleta posterior (cada
  movimentação inédita vira `new_movement`). Alternativa descartada: tratar 0 hits como
  `partial` faria um processo permanentemente indisponível ser consultado para sempre,
  desperdiçando a cota compartilhada de 120 req/min. Qualquer semântica adicional para
  `first_sync_done` nesse caso fica para a Fase de Notificações.
- **Autenticação da Edge Function:** *fail closed* em qualquer ambiente — sem
  `COLLECTOR_INVOKE_SECRET` a função responde `503` e não processa nada; com o secret,
  exige `Authorization: Bearer <secret>` (401 caso contrário). O gate de JWT do gateway
  (`verify_jwt`) fica desligado porque este é o único gate.
- **Espaçamento do lote:** `claim → fetch → submit` são contíguos; a pausa de ~600 ms
  fica **entre** o `submit` de uma run e o `claim` da próxima — nenhuma `collection_run`
  fica em `running` durante o intervalo artificial.
- **Timeout:** global da operação HTTP (conexão + headers + corpo + parse), não só da
  conexão.

**Validações pendentes para go-live** (não bloqueiam o commit do código): rodar
`deno test` do handler com os pacotes compilados; `scripts/datajud-smoke.mjs` contra um
CNJ público real e conferir o envelope campo a campo; validar o disparo do `pg_net`/cron
`0023` num ambiente com as GUCs `app.collector_datajud_url` / `app.collector_invoke_secret`
configuradas.

---

## Legenda de confiança

| Marca | Significado |
|---|---|
| ✅ **CONFIRMADO** | Está na documentação oficial do CNJ (wiki DataJud, Termo de Uso, exemplos oficiais). |
| 🟡 **INFERÊNCIA** | Comportamento padrão de Elasticsearch / boa prática; não é afirmado explicitamente para o DataJud. |
| 🔴 **NÃO CONFIRMADO** | Precisa ser validado na implementação (chamada real controlada) ou junto ao CNJ. |

Fontes oficiais consultadas: wiki `datajud-wiki.cnj.jus.br/api-publica` (páginas *Acesso*,
*Endpoints*, *Termo de Uso*, *Exemplos 1–3*), Termo de Uso v1.1 (CNJ), Portaria CNJ nº 160/2020.

---

## 1. O que já existe (inspeção) e como o DataJud se encaixa

| Peça | Estado | Papel na Acompanhamento-B |
|---|---|---|
| `packages/collectors-core` — `ProcessDataSource` (`kind`, `canHandle`, `fetch`), `SourceRegistry`, `RawMovement`, `SourceFetchResult` (+ `partial?`) | pronto, **imutável** | O `DataJudAdapter` implementa `ProcessDataSource`. Registrado no `SourceRegistry` com `kind='datajud'`. |
| `@juriflow/movement-normalizer` — `normalizeMovement`, `detectChanges`, `contentHash`, `stateHashOf` | pronto | O adapter só produz `RawMovement`; a normalização e a detecção **não mudam**. |
| `@juriflow/collector-engine` — `runCollection`, `classifyError`, `MockSourceAdapter` (em `testing/`), `runCollectorTick` | pronto | `runCollection` recebe qualquer `ProcessDataSource` — Mock e DataJud são intercambiáveis. **Sem alteração no engine.** |
| Migrations `0016`–`0021` — `movement_categories`, `court_tracking_strategies`, `process_tracking_configs` (`unique(process_id, source_kind)`), `process_tracking_state`, `collection_runs` (lock `where status='running'`), `collection_raw_payloads`, `process_movements` (append-only), `process_change_events`, `job_runs` | prontas | O DataJud **reusa tudo**. Não cria tabela nova de negócio. Eventual seed de taxonomia é aditivo. |
| RPCs `set_process_tracking`, `configure_process_tracking`, `collect_process_now`, `claim_pending_collection_run`, `submit_collection_result`, `submit_collection_failure`; `app.tracking_sweep` (pg_cron a cada 10 min) | prontas | O runtime do DataJud consome exatamente `claim_pending_collection_run → runCollection → submit_collection_result / submit_collection_failure`. |
| Frontend — `process-tracking-panel.component.ts` já lista fontes de `court_tracking_strategies`, já mostra "Fonte: DataJud — pode haver atraso" (chave `sourceKind==='datajud'`), timeline de movimentações | pronto | Nenhuma mudança estrutural. Ajuste opcional: exibir `dataHoraUltimaAtualizacao`. |
| `supabase/functions/` | **não existe** | Será criada uma Edge Function `collector-datajud`. |
| `packages/*/adapters/` | **não existe** | Novo pacote `@juriflow/adapter-datajud` (mantém o engine sem conhecer fontes). |

**Conclusão da inspeção:** o DataJud entra como **um adapter + um runtime (Edge Function)**,
sem segundo mecanismo. Nada da Acompanhamento-A precisa mudar de comportamento.

---

## 2. Documentação oficial utilizada

- `https://datajud-wiki.cnj.jus.br/api-publica/` — visão geral, base regulatória (Portaria nº 160 de 09/09/2020).
- `.../api-publica/acesso/` — autenticação por **Chave Pública** e o valor vigente.
- `.../api-publica/endpoints/` — URL base, padrão `/{alias}/_search`, lista de aliases.
- `.../api-publica/exemplos/exemplo1/` — request/response por número de processo.
- `.../api-publica/exemplos/exemplo2/` — response por classe/órgão; campos de `_source` e `movimentos`.
- `.../api-publica/exemplos/exemplo3/` — paginação com `search_after`.
- `.../api-publica/termo-uso/` + Termo de Uso v1.1 — limites, restrições, disclaimer de atualidade.

---

## 3. Endpoints

✅ **Base:** `https://api-publica.datajud.cnj.jus.br/`
✅ **Padrão:** `https://api-publica.datajud.cnj.jus.br/{alias}/_search`
✅ **Método:** `POST`
✅ **Aliases** (formato `api_publica_<tribunal>`): superiores `api_publica_tst`, `api_publica_tse`,
`api_publica_stj`, `api_publica_stm`; federal `api_publica_trf1`…`api_publica_trf6`; estadual
`api_publica_tjac`, `api_publica_tjam`, `api_publica_tjsp`, `api_publica_tjmg`… (27 UFs);
trabalhista `api_publica_trt1`…`api_publica_trt24`; eleitoral `api_publica_tre-xx`; militar
`api_publica_tjmxx`.
🔴 **A lista completa e a grafia exata de cada alias** deve ser copiada da wiki no momento da
implementação (a wiki é a fonte canônica; ex.: `tre-sp` com hífen).

---

## 4. Autenticação

✅ Por **Chave Pública** (published pelo DPJ/CNJ), header:

```
Authorization: APIKey cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==
Content-Type: application/json
```

- ✅ A wiki afirma que a chave **pode mudar a qualquer momento** por segurança.
- 🟡 O exemplo 1 da wiki escreve `Authorization: ApiKey <API Key>` (capitalização diferente de
  `APIKey` na página *Acesso*). O esquema de autenticação HTTP é **case-insensitive** (RFC 7235),
  então ambos funcionam; usaremos o valor da página *Acesso*.
- 🔴 Não há menção de token por usuário / cadastro / OAuth. É uma **chave compartilhada**.
  Implica rate limit compartilhado (ver §8).

---

## 5. Request

✅ Corpo = **Elasticsearch Query DSL**. Consulta por número de processo (exemplo oficial):

```json
POST https://api-publica.datajud.cnj.jus.br/api_publica_trf1/_search
{
  "query": { "match": { "numeroProcesso": "00008323520184013202" } }
}
```

- ✅ `numeroProcesso` é **somente dígitos (20)**, sem máscara.
- 🟡 Para a nossa consulta por CNJ acrescentaremos `"size": 1` (esperamos exatamente 1 documento).
- ✅ Consulta por classe + órgão (exemplo 2): `bool.must` com `match` em `classe.codigo` e
  `orgaoJulgador.codigo`. **Não usaremos** essa forma (JuriFlow rastreia por processo).
- 🔴 Se `match` em `numeroProcesso` pode, em algum tribunal, retornar >1 hit (ex.: reautuação)
  — validar; se ocorrer, escolher o de `dataHoraUltimaAtualizacao` mais recente ou usar
  `term`/`match_phrase`.

---

## 6. Response

✅ Envelope Elasticsearch:

```json
{
  "took": 6679,
  "timed_out": false,
  "hits": {
    "total": { "value": 1 },
    "max_score": 13.917,
    "hits": [
      { "_index": "...", "_id": "...", "_score": 13.917, "_source": { ... }, "sort": [ ... ] }
    ]
  }
}
```

✅ Campos de `hits.hits[]._source`:

| Campo | Tipo | Notas |
|---|---|---|
| `numeroProcesso` | string (20 dígitos) | ✅ |
| `classe` | `{ codigo, nome }` | ✅ classe processual (TPU) |
| `sistema` | `{ codigo, nome }` | ✅ (ex.: PJe) |
| `formato` | `{ codigo, nome }` | ✅ (Eletrônico/Físico) |
| `tribunal` | string | ✅ (ex.: "TRF1") |
| `grau` | string | ✅ (ex.: "JE", "G1", "G2") |
| `orgaoJulgador` | `{ codigoMunicipioIBGE, codigo, nome }` | ✅ |
| `dataAjuizamento` | date (`YYYY-MM-DD`) | ✅ |
| `dataHoraUltimaAtualizacao` | datetime ISO (`...Z`) | ✅ — **quando o DataJud atualizou este documento** |
| `@timestamp` | datetime ISO | ✅ — timestamp de indexação (usado em `sort`/`search_after`) |
| `id` | string | ✅ — id do documento (do processo, **não** da movimentação) |
| `nivelSigilo` | int | ✅ — 0 para os públicos (sigilosos ficam fora, Portaria 160) |
| `assuntos` | `[{ codigo, nome }]` | ✅ |
| `movimentos` | `[{ codigo, nome, dataHora, complementosTabelados? }]` | ✅ **array embutido no documento** |

✅ `movimentos[]` (item):

| Subcampo | Tipo | Notas |
|---|---|---|
| `codigo` | int | ✅ código do movimento na **TPU/CNJ** (não é único por movimento) |
| `nome` | string | ✅ rótulo do movimento |
| `dataHora` | datetime ISO | ✅ data/hora da movimentação |
| `complementosTabelados` | `[{ codigo, valor, nome, descricao }]` | ✅ **opcional** — detalhamento |

🔴 **Não existe identificador único por movimentação** no `_source` público. É o achado mais
importante desta análise (impacta §14 e §15).
🔴 Variações de schema por tribunal/grau (campos extras, ausência de `complementosTabelados`,
`orgaoJulgador` por movimento em alguns sistemas) — validar com fixtures de vários tribunais.

---

## 7. Paginação

✅ Elasticsearch: `size` entre **10 e 10.000** por página; `from`+`size` ou **`search_after`**
com `sort` (a wiki usa `sort: [{ "@timestamp": { "order": "asc" } }]` e devolve `hits[].sort`
para passar como `search_after` na página seguinte).
🟡 `from + size` limitado a `index.max_result_window` (padrão ES = 10.000). 🔴 Não confirmado
se o DataJud sobrescreve esse limite.
🟡 Última página = `hits.hits.length < size` (ou vazio).

**Encaixe no JuriFlow:** a consulta **por `numeroProcesso` retorna 1 documento** com **todos**
os `movimentos` no array. Portanto:

- **Não há paginação de movimentações** — elas vêm todas de uma vez.
- `size: 1` na query. A paginação `search_after` só seria necessária na estratégia por
  tribunal/data (que **não** usaremos).
- O mecanismo `partial` da Acompanhamento-A **praticamente não se aplica** ao DataJud-por-CNJ:
  ou o documento vem inteiro (`success`) ou a chamada falha (`failed`). 🟡 Um processo com
  milhares de movimentos gera um `_source` grande, mas ainda é uma única resposta. Se o
  parsing/tamanho estourar limite da Edge Function (§10), tratamos como `failed`
  (`unavailable`/`parse_error`), **não** como `partial` — não há como pedir "só parte do array".
- **Limite de segurança:** `court_tracking_strategies.params.max_movements` (ex.: 5.000). Se
  `movimentos.length > max_movements`, o adapter processa os `max_movements` mais recentes
  (ordenados por `dataHora` desc), marca `SourceFetchResult.partial = true` e loga; a próxima
  execução re-consulta (o dedup por `content_hash` absorve). Isso reaproveita o `partial` da A
  **sem alterar a A** — é só o adapter setando o flag.

---

## 8. Rate limit / limites

✅ **Termo de Uso:** *"O usuário concorda em não realizar mais de **120 requisições por
minuto**"* sem autorização expressa por escrito do CNJ.
✅ **Disclaimer:** *"O CNJ não garante a precisão, integridade ou **atualidade** dos dados"*
(art. 3.6). *"Não modificar, distribuir, vender ou explorar comercialmente a API"* (art. 3.8).
🔴 **Comportamento de 429** (código, presença de `Retry-After`, janela) — não documentado.
🔴 **Limite por chave / por IP** e se há limite diário — não documentado além dos 120/min.

**Orçamento do JuriFlow:** 1 requisição por `(processo, datajud)` por dia (rotina 08:00).
Com N processos rastreados via DataJud, o sweep enfileira N runs. A Edge Function processa em
lotes com **pausa de ~600 ms entre chamadas** (~100/min < 120) e re-invocação por cron até a
fila drenar. Jitter de ±15 min no `next_run_at` (já existe na A) espalha o pico. Para N muito
grande, solicitar limite maior ao CNJ (permitido pelo Termo com autorização escrita).

---

## 9. Erros

Mapeamento para as classes já existentes em `@juriflow/collector-engine` (`CollectionError`):

| Situação DataJud | Detecção | Classe | Retriável |
|---|---|---|---|
| Sem resposta no tempo limite | `AbortController` estoura | `timeout` | sim |
| `5xx`, DNS/conexão, gateway | status ≥ 500 / erro de rede | `unavailable` | sim |
| `429` | status 429 (🟡 ler `Retry-After` se vier) | `rate_limited` | sim |
| `401` / `403` | status 401/403 | `auth_failed` | **não** (alerta ADMIN) |
| Corpo não-JSON ou envelope inesperado | `JSON.parse` falha / faltam `hits.hits` | `parse_error` | **não** |
| `200` com `hits.total.value == 0` | 0 hits | `not_found` | **não** (marca a fonte) |
| Outro | — | `unknown` | sim (limitado) |

**Interação com a A (sem alterar a A):**

- `submit_collection_failure` já: incrementa `consecutive_failures`, aplica backoff fixo
  `5m/15m/1h/3h/6h` (máx 5 tentativas), **auto-pausa após 5 falhas** (`enabled=false`,
  `pause_reason='consecutive_failures'`, audita `tracking.auto_paused`), cancela retries
  pendentes. **Tudo isso vale para o DataJud sem mudança.**
- 🔴 **Incompatibilidade a decidir:** a A **ignora `Retry-After`**. Se o `429` do DataJud pedir
  "espere 30 s", a A só re-tentará em 5 min (mais conservador — sem risco). Recomendação:
  **não alterar a A agora**; o adapter apenas registra o `Retry-After` em log/`error_message`.
  Se, na prática, virem muitos `429`, aí sim aprovar um parâmetro aditivo `retry_after_seconds`
  em `submit_collection_failure` (`next_retry_at = now() + greatest(backoff, retry_after)`).
- `collection_runs` já tem `http_status`, `error_code`, `error_message` — o adapter preenche.
- `job_runs` já registra o sweep. A Edge Function registrará seu próprio `job_runs`
  (`job_name='collector_datajud_tick'`) — aditivo, mesma tabela.

---

## 10. Estratégia de consulta

**Decisão: consulta EXCLUSIVAMENTE por número CNJ (`numeroProcesso`), 1 chamada por
`(processo, execução)`, `size: 1`.**

Justificativa (dado que o DataJud pode estar atrasado e não é tempo real):

- É a consulta com **contrato mais estável e simples**: número CNJ → 1 documento com histórico
  completo. Sem paginação, sem `search_after`, sem risco de perder movimentos.
- Não depende de `grau`/`órgão`/`classe` (que podem variar e não são conhecidos com precisão
  pelo JuriFlow no cadastro).
- `since`/intervalo de datas **não** é usado como parâmetro (ver §11) — o documento sempre
  vem inteiro e a deduplicação por `content_hash` resolve.
- Consulta por tribunal/data (bulk) seria mais eficiente em volume, mas: exige paginação
  profunda, traz processos de terceiros (fora do escopo do espaço) e acopla o JuriFlow ao
  schema de filtros do DataJud. **Descartada.**
- O `alias` do tribunal (`api_publica_tjam` etc.) vem de `court_tracking_strategies.params`.
  Processo sem CNJ **nunca** chega ao DataJud (a estratégia `datajud` tem `requires_cnj=true`
  — já garantido pela elegibilidade da A).

O núcleo (`ProcessDataSource`) não muda: o adapter recebe `fetch({ target: { cnjNumber, courtId,
params }, since?, requestId })` e devolve `SourceFetchResult`.

---

## 11. Estratégia incremental (`since`)

🔴 **O DataJud não oferece incremental confiável no nível da movimentação.** A consulta por
`numeroProcesso` sempre retorna **todo** o `movimentos[]`. Não há filtro "movimentos após X".

Estratégia adotada:

1. **Otimização barata (opcional):** o `claim_pending_collection_run` já entrega
   `state.last_synced_at` (implicitamente via `state_hash_before`). Se quisermos, o adapter
   pode primeiro fazer a mesma consulta e comparar `_source.dataHoraUltimaAtualizacao` com o
   último sync — se `<=`, retorna 0 movimentos novos sem processar o array. **Custo:** ainda é
   1 chamada (não economiza requisição), só economiza CPU. 🟡 Recomendação: **não implementar
   essa micro-otimização em B** — o dedup por hash já é barato; simplicidade primeiro.
2. **Fonte de verdade da novidade:** `known_content_hashes` (que a A já passa no `claim`) +
   `detectChanges`. O adapter **sempre** entrega todos os movimentos como `RawMovement`; o
   engine descarta os já conhecidos (`ON CONFLICT DO NOTHING` + eventos só para os novos).
3. **Janela de sobreposição de ~7 dias (aprovada na A):** para o DataJud-por-CNJ ela é um
   **no-op** — como sempre vem o histórico completo, não há "janela" a sobrepor. Mantemos a
   janela para fontes futuras (API de tribunal, Projudi) que suportem incremental real.
   **Justificativa para não mexer nos 7 dias:** o DataJud não usa `since`; alterar a janela
   não muda nada para ele e poderia afetar outras fontes.
4. **1ª sincronização:** `state.first_sync_done = false` → `runCollection` marca todos os
   movimentos com `is_first_sync=true` e emite **só `first_sync_completed`** (RN11). Já
   funciona.

---

## 12. Mapeamento DataJud → `RawMovement`

Para cada item de `_source.movimentos[]` o adapter produz:

```ts
{
  sourceKind: 'datajud',
  sourceMovementId: null,                     // DataJud não fornece id de movimentação
  occurredAt: movimento.dataHora ?? null,     // ISO; null ⇒ needsReview no normalizador
  description: buildDescription(movimento),    // nome + " — " + complementos (nome: valor|descricao)
  raw: {
    movementCode: String(movimento.codigo),   // lido por readHint() do normalizador
    movementLabel: movimento.nome,
    complementosTabelados: movimento.complementosTabelados ?? [],
    // contexto do processo no momento da coleta (para auditoria/re-normalização):
    processo: { tribunal, grau, orgaoJulgador, classe, dataHoraUltimaAtualizacao }
  }
}
```

- `buildDescription` (puro, no adapter ou no normalizador): `nome`; se houver
  `complementosTabelados`, anexar `" — "` + `complementos.map(c => c.nome + ': ' + (c.valor ?? c.descricao)).join('; ')`. 🟡 Ordenar `complementosTabelados` por `codigo` antes de concatenar (estabilidade do hash).
- `SourceFetchResult`: `{ sourceKind: 'datajud', collectedAt: <agora ISO>, movements: [...], partial?: <true se aplicou max_movements> }`.

**Campos:** obrigatórios de fato → `codigo`, `nome`, `dataHora` (✅ presentes nos exemplos).
Opcional → `complementosTabelados`. 🔴 Se algum tribunal omitir `dataHora` em algum movimento,
`occurredAt=null` → `needsReview=true` (o normalizador já faz).

---

## 13. Mapeamento para `CanonicalMovement`

Feito pelo `@juriflow/movement-normalizer` **sem alteração** (já lê `movementCode`/`movementLabel`
do `raw`):

| Canônico | Origem | Regra |
|---|---|---|
| `occurredAt` | `movimento.dataHora` | ISO; `null` ⇒ `needsReview` |
| `categoryCode` | `resolveCategory({ code: movimento.codigo })` | `movement_categories.code == String(codigo)`; senão `null` |
| `categoryLabel` | categoria resolvida OU `movimento.nome` | fallback para o rótulo do DataJud |
| `description` | `buildDescription(movimento)` | normalizada para exibição |
| `sourceMovementId` | — | **sempre `null`** |
| `raw` | objeto do movimento + contexto do processo | preservado |
| `contentHash` | `sha256(isoDay(dataHora) ⋄ codigo ⋄ normalizeForHash(nome+complementos) ⋄ '' ⋄ 'datajud')` | já implementado |
| `needsReview` | `occurredAt==null` OU categoria não resolvida | já implementado |

**Categorias que não mapeiam:** `movimento.codigo` que não estiver em `movement_categories`
→ `categoryCode=null`, `categoryLabel=nome`, `needsReview=true`. Ver §21 (taxonomia).

---

## 14. Estratégia de `source_movement_id`

🔴 **DataJud não fornece.** Portanto `source_movement_id = null` para toda movimentação DataJud.

**Consequência:** a detecção de **`movement_amended`** depende de casar
`source_movement_id` conhecido com hash diferente (implementado na A). Como o DataJud não tem
id, **uma movimentação editada pelo DataJud aparece como `new_movement`** (novo `content_hash`),
e a versão antiga permanece (histórico append-only). O caminho `movement_amended` /
`revision_of` **continua existindo** para fontes futuras que tenham id estável (API de
tribunal, Projudi).

**Não recomendado:** heurística de "mesma data + mesmo código = mesma movimentação" para
inferir amendment — risco alto de fundir movimentos legítimos distintos (várias movimentações
do mesmo tipo no mesmo dia são comuns).

Ver §26 — precisa de aceite explícito dessa limitação para a Acompanhamento-B.

---

## 15. Estratégia de `content_hash`

O `content_hash` é a **única identidade** de uma movimentação DataJud. Já calculado pelo
`movement-normalizer` a partir de:

`isoDay(dataHora)` ⋄ `String(codigo)` ⋄ `normalizeForHash(descrição já com complementos)` ⋄
`sourceMovementId` (vazio) ⋄ `'datajud'`.

Reforços para B:

- **Truncar `dataHora` ao dia** (já feito) — o DataJud às vezes muda a hora sem mudar o fato.
- **Ordenar `complementosTabelados`** antes de compor a descrição (estabilidade).
- **Usar `codigo` (não `nome`) como chave de categoria no hash** (já feito via `categoryKey`) —
  se o CNJ ajustar o texto de `nome`, o hash não muda.
- 🟡 **Risco residual:** se o DataJud corrigir o `codigo` de um movimento (raro) ou o dia,
  gera um `content_hash` novo → movimento "duplicado" na timeline. Frequência baixa; aceitável;
  registrar como risco (RT-DJ-3).

Preservado: `new_movement` para hash inédito; `revision_of`/`movement_amended` só quando há id
(não para DataJud); **zero duplicação em reexecução** (`unique(process_id, source_kind,
content_hash)` + `ON CONFLICT DO NOTHING`).

---

## 16. Estratégia de retry

Reusa integralmente a Acompanhamento-A (nada muda):

- Classificação do erro pelo adapter (§9) → `submit_collection_failure({ error_code, retriable })`.
- Backoff fixo `5m → 15m → 1h → 3h → 6h`, **máx. 5 tentativas**, depois `failed` definitivo.
- **Auto-pausa após 5 falhas consecutivas** + `audit_logs('tracking.auto_paused')` + cancelamento
  dos retries pendentes.
- `auth_failed` / `parse_error` / `not_found` → **sem retry**, aparecem no painel do processo
  com mensagem amigável (já implementado em `friendlyCollectionError`).
- 🔴 Único ponto a decidir: honrar `Retry-After` do `429` (ver §9) — recomendação: **não**
  agora.

---

## 17. Estratégia de timeout

- ✅ Observado `"took": 6679` (ms) num exemplo simples da wiki → a API pode ser lenta.
- **Timeout do cliente:** `court_tracking_strategies.params.timeout_ms` (default **30000**).
  Implementado com `AbortController` + `setTimeout` em volta do `fetch`.
- Estouro → `CollectionTimeoutError` (`timeout`, retriável).
- 🟡 Também podemos enviar `?timeout=25s` no request do ES (timeout do lado do servidor), mas
  isso retorna resultado parcial com `timed_out: true` — nesse caso tratamos como
  `partial`/`unavailable` (não confiar em documento incompleto).
- 🔴 Timeout ideal por tribunal (alguns são mais lentos) — ajustável em `params` pelo
  SUPER_ADMIN.

---

## 18. Estratégia de runtime

**Decisão: DataJud → Supabase Edge Function (Deno).** Sem `collector-worker`.

Viabilidade (✅ salvo onde indicado):

| Requisito | Avaliação |
|---|---|
| HTTP externo | ✅ `fetch` global no Deno; a Edge Function faz chamadas de saída. |
| Duração | ✅ 1 POST (~1–7 s) + parse + `runCollection` (puro, ms) + 1–2 RPCs. Muito abaixo do limite de wall-clock da Edge Function (🟡 ~150 s no plano free; configurável). |
| Memória | 🟡 `_source` de um processo com milhares de movimentos pode ter alguns MB de JSON; dentro de ~256 MB. O `max_movements` (§7) limita o pior caso. |
| Paginação | N/A para consulta por CNJ (documento único). |
| Retries | Feitos pelo banco (`submit_collection_failure` reenfileira). A função **não** faz retry em memória. |
| Conectividade | ✅ Edge Function → `api-publica.datajud.cnj.jus.br` (HTTPS). 🔴 Confirmar que não há allowlist de IP de saída restritiva. |
| Segredo | ✅ Edge Function *secrets* (`DATAJUD_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`). |
| Executar o `collector-engine` | ✅ `@juriflow/movement-normalizer` usa `node:crypto` (`createHash`), suportado pelo Deno. `@juriflow/collector-engine` e `@juriflow/adapter-datajud` são ESM puros. Import via `npm:` specifier ou bundling. 🔴 Validar o import dos pacotes do workspace na Edge Function (provável: um pequeno passo de bundle no deploy). |

**Fluxo da Edge Function `collector-datajud`:**

```
pg_cron (a cada N min) ──net.http_post──▶ Edge Function /collector-datajud
                                              │  (auth: service_role JWT ou secret compartilhado)
                                              ▼
  loop (lote de até K runs, pausa ~600ms entre iterações):
    claim_pending_collection_run()  ── só reclama runs de source_kind='datajud' (ver nota)
      │ null ⇒ break
      ▼
    DataJudAdapter.fetch({ target: { cnjNumber, courtId, params }, requestId: run_id })
      │
      ▼
    runCollection(...)  →  submit_collection_result(...) | submit_collection_failure(...)
  registra job_runs('collector_datajud_tick', {claimed, ok, failed})
```

🔴 **Nota sobre `claim_pending_collection_run`:** hoje ele reclama **qualquer** fonte. Para B,
como só existirá o adapter DataJud, tudo bem. Quando entrar a Acompanhamento-C (worker + TJAM),
será preciso um filtro por `source_kind` no claim (parâmetro `p_source_kinds text[]`). Isso é
uma **alteração aditiva futura** — **não** nesta fase. Alternativa para B sem tocar no claim:
como só há DataJud, o claim pega só DataJud naturalmente.

Agendamento: um `cron.schedule('collector-datajud-tick', '*/5 * * * *', $$ select net.http_post(...) $$)`
guardado (extensão `pg_net`), numa migration aditiva `0022`. 🔴 A URL da função e o segredo de
invocação entram como *Vault secret* / GUC de projeto (não hardcode na migration).

---

## 19. Estratégia de credenciais

| Segredo | Onde | Acesso |
|---|---|---|
| `DATAJUD_API_KEY` (chave pública do CNJ) | **Edge Function secret** (`supabase secrets set`) | só a função |
| `SUPABASE_SERVICE_ROLE_KEY` (para chamar as RPCs `claim`/`submit`) | **Edge Function secret** | só a função |
| Segredo de invocação da função pelo `pg_cron`/`pg_net` | **Vault** do projeto, lido pela migration/rotina de agendamento | só o job |

- **Nunca** em `court_tracking_strategies.params` — essa coluna é **legível por qualquer
  autenticado** (RLS `cts_select using (true)`). `params` só recebe `{alias, timeout_ms,
  max_movements, priority_hint}`.
- **Nunca** no bundle Angular nem em `process_tracking_configs.source_params`.
- **Supabase Vault** é alternativa se, no futuro, a coleta rodar fora de Edge Function
  (worker) — aí o worker lê do Vault. Para B, *secrets* da Edge Function bastam. **A parte de
  infraestrutura de segredo pode ser feita na etapa de implementação** (não bloqueia a
  análise).
- `Logger`: já redige `authorization`; adicionar regra para **não logar corpo `raw`** nem
  `DATAJUD_API_KEY` em nenhum nível.

---

## 20. Integração com `court_tracking_strategies`

O SUPER_ADMIN cria **uma linha por tribunal atendido**:

| Coluna | Valor para DataJud |
|---|---|
| `court_id` | o tribunal (ex.: TJAM) |
| `source_kind` | `datajud` |
| `requires_cnj` | `true` (sempre — DataJud consulta por número) |
| `enabled` | `true` |
| `priority` | ex.: `100` (referência; DataJud costuma ser a fonte base) |
| `params` | `{"alias": "api_publica_tjam", "timeout_ms": 30000, "max_movements": 5000}` — **sem segredo** |

- `endpoint_base` (`https://api-publica.datajud.cnj.jus.br`) → **constante na Edge Function**,
  não em `params` (evita erro de configuração e não é dado que o SUPER_ADMIN precise mexer).
- O **ADMIN do espaço** só faz `set_process_tracking(process, 'datajud', true/false)` e
  `collect_process_now` — **não** enxerga nem edita `alias`/`timeout`/`max_movements`. Isso já é
  garantido pela A (`ptc_guard_field_updates` bloqueia campos técnicos para não-SUPER_ADMIN /
  não-ADMIN; `params` da estratégia é global e só SUPER_ADMIN escreve).
- Sem estratégia `datajud` cadastrada para o tribunal → o painel do processo mostra "Processo
  não acompanhado" para essa fonte (já implementado).

---

## 21. Impacto no `collector-engine`

**Nenhuma alteração de código.** `runCollection` já é agnóstico de fonte. O `DataJudAdapter`
apenas implementa `ProcessDataSource`.

Ponto de atenção — **taxonomia (`movement_categories`)**: a semente atual tem **16 códigos**; o
DataJud usa toda a **TPU/CNJ (Movimentos)** — centenas de códigos. Sem ampliar a taxonomia,
**quase toda movimentação coletada terá `needsReview=true`** e `categoryCode=null` (o
`categoryLabel` ainda vem do DataJud, então a timeline exibe o nome — não quebra, mas polui o
"revisar").

Opções (decisão do produto — §26):

- **(A) Semear um subconjunto curado** (~200–400 códigos de movimento "folha" mais comuns) numa
  migration **aditiva** de dados na Acompanhamento-B. Reduz drasticamente o `needsReview`.
- **(B) Semear a TPU completa** de Movimentos (arquivo oficial do CNJ/SGT) — mais completo,
  mais linhas, mas estável. Encaixaria melhor na **Fase 4** (Tribunais/DataJud estrutural).
- **(C) Não semear em B** — aceitar `needsReview` alto temporariamente.

**Recomendação:** (A) em B + (B) na Fase 4. É aditivo, não altera schema.

---

## 22. Impacto no frontend

**Estruturalmente nenhum.** O `process-tracking-panel` já:

- lista a fonte `datajud` (de `court_tracking_strategies`);
- mostra o aviso *"Fonte: DataJud — pode haver atraso em relação ao tribunal"* (chave
  `hasDelayWarning('datajud')`);
- renderiza a timeline (`categoryLabel` + `description` + badges `revisar` / `1ª sincronização`);
- botões **Ativar/Desativar** e **Coletar agora** (ADMIN ou responsável).

Ajustes **opcionais** (aditivos, podem ficar para depois de B):

- Exibir `dataHoraUltimaAtualizacao` do DataJud ("dados do tribunal no DataJud atualizados em
  …") — precisa expor esse campo; hoje não é guardado (ver §23).
- Texto do aviso de atraso mais explícito conforme §13.

---

## 23. Impacto no banco

| Item | Tipo | Necessário em B? |
|---|---|---|
| Semente de `movement_categories` (subconjunto TPU) | **migration de dados, aditiva** | Recomendado (§21). Não altera schema. |
| Linhas de `court_tracking_strategies` para os tribunais atendidos (TJAM, …) | **dados** (inserção pelo SUPER_ADMIN ou seed de dev) | Sim, para funcionar. |
| Agendamento `cron.schedule('collector-datajud-tick', …)` + `net.http_post` para a Edge Function | **migration aditiva `0022`**, guardada por `pg_net`/`pg_cron` disponíveis | Sim. |
| GUC/Vault com URL + segredo de invocação da função | config (não schema) | Sim (pode ser passo de infra). |
| `claim_pending_collection_run` com filtro `p_source_kinds` | alteração **aditiva** de assinatura | **Não em B** (só DataJud existe). Fica para a C. |
| `submit_collection_failure` com `retry_after_seconds` | alteração **aditiva** | **Não em B** (recomendado adiar). |
| `processes` / `courts` | — | **Nenhuma alteração.** |
| RLS | — | **Nenhuma alteração.** |

Se algo do comportamento real do DataJud exigir mudar o modelo da A (ex.: `partial` não
suficiente, precisar de coluna nova em `process_movements`): **não alterado agora** — apontado
como incompatibilidade em §26 / Riscos.

---

## 24. Testes necessários (implementação futura, sem API real)

Pacote `@juriflow/adapter-datajud` — o construtor recebe um `fetchFn` injetável (default:
`globalThis.fetch`); os testes passam um stub.

| Teste | Fixture / stub |
|---|---|
| Happy path: 1 hit, N movimentos → N `RawMovement` com `movementCode`/`movementLabel`/`dataHora` | fixture anonimizada `hit-simple.json` |
| `complementosTabelados` presentes → `description` composta e ordenada | `hit-complementos.json` |
| Movimento sem `dataHora` → `occurredAt=null` (`needsReview` via normalizador) | `hit-missing-datahora.json` |
| `codigo` fora da taxonomia → `categoryCode=null` | fixture + `resolveCategory` de teste |
| 0 hits (`hits.total.value=0`) → `CollectionNotFoundError` | `hits-empty.json` |
| HTTP 429 (+ `Retry-After`) → `CollectionRateLimitedError` | stub Response 429 |
| HTTP 503 / erro de rede → `CollectionUnavailableError` | stub |
| HTTP 401 → `CollectionAuthError` (não retriável) | stub |
| Corpo não-JSON / envelope sem `hits` → `CollectionParseError` | stub |
| Timeout (`AbortController`) → `CollectionTimeoutError` | stub que nunca resolve + fake timers |
| `movimentos.length > max_movements` → só os mais recentes + `SourceFetchResult.partial=true` | `hit-huge.json` |
| Integração com `runCollection`: 1ª sync → só `first_sync_completed` | fixture + engine real |
| Integração: 2ª chamada só com hash novo → `new_movement`; reexecução → 0 eventos (idempotência) | fixture + `known` |
| `runCollectorTick` com fake RPC + DataJudAdapter(stub) → `submit_collection_result` correto | reusa o padrão de `tick.spec.ts` |
| Edge Function `collector-datajud` — teste de unidade do handler com RPC + fetch stubados (Deno test) | — |

Smoke manual (fora do CI): `scripts/datajud-smoke.mjs` — 1 chamada real por um CNJ público
conhecido, imprime o mapeamento; **nunca** roda no `npm test`/CI.

Fixtures = **respostas reais capturadas uma vez e anonimizadas** (remover qualquer nome/valor
sensível de `complementosTabelados`; manter a forma). Guardadas em
`packages/adapter-datajud/src/testing/fixtures/`.

---

## 25. Riscos

| ID | Risco | Severidade | Mitigação |
|---|---|---|---|
| RT-DJ-1 | **Sem id de movimentação** → `movement_amended` impossível para DataJud; edições viram `new_movement` | Média | Aceitar e documentar (§14); caminho `revision_of` permanece para outras fontes |
| RT-DJ-2 | **Taxonomia mínima** → `needsReview` altíssimo | Média | Semear subconjunto TPU curado em B (§21) |
| RT-DJ-3 | `content_hash` muda se o DataJud corrigir `codigo`/dia de um movimento → duplicata na timeline | Baixa | Truncar dia + usar `codigo` no hash (já feito); frequência baixa |
| RT-DJ-4 | **Atraso** do DataJud (sem garantia de atualidade — art. 3.6 do Termo) | Média | UI já avisa; DataJud é fonte de referência, não tempo real; Projudi/TJAM (fase C) para atualidade |
| RT-DJ-5 | **429 / limite de 120 req/min compartilhado** com todos os consumidores da chave pública | Média | Pausa ~600ms entre chamadas, lote limitado, jitter; auto-pausa por falha; pedir limite maior ao CNJ se preciso |
| RT-DJ-6 | Chave pública **pode mudar sem aviso** | Média | Chave em *secret* (troca sem deploy de código); alerta em `auth_failed` |
| RT-DJ-7 | `match` em `numeroProcesso` retornar >1 hit em algum tribunal | Baixa | Escolher `dataHoraUltimaAtualizacao` mais recente; validar com fixtures multi-tribunal |
| RT-DJ-8 | Processo de **segredo de justiça**: DataJud não retorna (0 hits) → `not_found` recorrente | Baixa | Tratar `not_found` como estado informativo no painel ("não disponível no DataJud"); não auto-pausar por `not_found` isolado (revisar regra de auto-pausa: `not_found` conta como falha?) — **decisão §26** |
| RT-DJ-9 | `_source` gigante (processo com milhares de movimentos) estourar memória/tempo da Edge Function | Baixa-Média | `max_movements` + `partial`; timeout; se falhar, `unavailable` e re-tenta |
| RT-DJ-10 | Import dos pacotes do workspace dentro do Deno (Edge Function) | Média | Passo de bundle no deploy; validar cedo (spike de 1 dia) |
| RT-DJ-11 | Termo de Uso proíbe "explorar comercialmente a API" (art. 3.8) | Baixo (jurídico) | JuriFlow consome metadados para o próprio cliente do processo; não revende a API. Registrar; validar com jurídico (PP) |

---

## 26. Decisões pendentes (precisam da sua resposta antes de implementar a B)

| # | Decisão | Recomendação |
|---|---|---|
| **DJ-1** | **Runtime = Supabase Edge Function** para o DataJud (sem worker). Aprova? | **Sim** (§18 confirma viabilidade) |
| **DJ-2** | Adapter como **pacote separado `@juriflow/adapter-datajud`** (mantém o `collector-engine` agnóstico) — vs. `collector-engine/src/adapters/`. | **Pacote separado** |
| **DJ-3** | **Sem `source_movement_id`**: aceitar que edições de movimentação no DataJud apareçam como `new_movement` (a antiga permanece), sem `movement_amended`? | **Sim, aceitar** (documentado; caminho permanece p/ outras fontes) |
| **DJ-4** | **Taxonomia**: semear um **subconjunto curado da TPU** (~200–400 códigos) em B (migration de dados, aditiva), e a TPU completa na Fase 4? | **Sim** (opção A do §21) |
| **DJ-5** | **Credenciais** (`DATAJUD_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) em **Edge Function secrets**; Vault só se a coleta sair da Edge Function no futuro. Aprova? | **Sim** |
| **DJ-6** | **Não alterar** a Acompanhamento-A agora: não honrar `Retry-After` (backoff fixo), não adicionar `p_source_kinds` ao `claim`, não adicionar coluna. Concorda? | **Sim** (revisitar na C / se 429 for frequente) |
| **DJ-7** | **`court_tracking_strategies.params`** guarda só `{alias, timeout_ms, max_movements}` (sem segredo); `endpoint_base` é constante na função. Aprova? | **Sim** |
| **DJ-8** | **Auto-pausa**: `not_found` (processo sigiloso ou fora do DataJud) **conta** como falha para os 5 strikes? | **Não** — `not_found` isolado não deve auto-pausar; tratar como estado "indisponível no DataJud". (Requer 1 ajuste no `submit_collection_failure`? — ver DJ-6; alternativa: o adapter não chama `submit_collection_failure` para `not_found`, e sim `submit_collection_result` com 0 movimentos + marca a config com um aviso. **Decidir**.) |
| **DJ-9** | **Tribunais iniciais**: configurar ao menos **TJAM** (`api_publica_tjam`); quais outros? | TJAM agora; demais conforme demanda |
| **DJ-10** | **Agendamento**: `pg_cron` + `pg_net` chamando a Edge Function a cada ~5 min (migration aditiva `0022`), guardado. Aprova? | **Sim** |
| **DJ-11** | **Consulta por `numeroProcesso` com `size:1`**, sem estratégia por tribunal/data. Aprova? | **Sim** (§10) |
| **DJ-12** | Aval **jurídico** sobre o Termo de Uso (art. 3.8 — não explorar comercialmente a API; art. 3.9 — dar ciência ao CNJ de estudos publicados). | Levar ao jurídico antes do go-live |

> **DJ-8** é a única que pode exigir um toque **mínimo e aditivo** na A. Se você preferir não
> tocar na A de forma alguma, o adapter trata `not_found` como `submit_collection_result` vazio
> (sem falha) — resolve sem migration.

---

## 27. Veredito

# ✅ APTO PARA IMPLEMENTAÇÃO

O contrato do DataJud (POST `/{alias}/_search`, corpo ES DSL, resposta com `_source.movimentos[]`)
**encaixa na arquitetura da Acompanhamento-A sem criar mecanismo paralelo e sem alterar o
comportamento existente**. As lacunas (sem id de movimentação, taxonomia mínima, `Retry-After`)
são conhecidas, contornáveis e documentadas.

### O que a próxima etapa (Acompanhamento-B) vai precisar

**Packages**

- `@juriflow/adapter-datajud` (novo): `DataJudAdapter implements ProcessDataSource`
  (`fetchFn` injetável), `buildDescription`, classificação de HTTP → `CollectionError`,
  `parseElasticEnvelope`, `mapMovimento → RawMovement`; `src/testing/fixtures/*.json`
  (respostas reais anonimizadas) e `*.spec.ts` (Vitest, §24). Deps: `@juriflow/collectors-core`
  (+ `@juriflow/collector-engine` só nos testes de integração). Registrado em
  `tsconfig.json` raiz e `vitest.config.ts`.

**Edge Function**

- `supabase/functions/collector-datajud/index.ts` (Deno): handler autenticado; loop
  `claim_pending_collection_run → runCollection(DataJudAdapter) → submit_*`; lote limitado +
  pausa ~600 ms; grava `job_runs('collector_datajud_tick', …)`. Secrets:
  `DATAJUD_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- `supabase/functions/collector-datajud/deno.json` (import map / bundle dos pacotes do
  workspace) — validar via spike (RT-DJ-10).

**Migrations (todas aditivas — nada em `processes`/`courts`/RLS)**

- `0022_acomp_datajud_schedule.sql`: `cron.schedule('collector-datajud-tick', '*/5 * * * *',
  net.http_post(<url>, headers, body))`, guardado por `pg_cron`/`pg_net` disponíveis; URL e
  segredo de invocação via Vault/GUC.
- `0023_datajud_movement_taxonomy.sql` (**dados**): `insert into public.movement_categories …
  on conflict do nothing` — subconjunto curado da TPU de Movimentos (DJ-4).
- (opcional, dev) seed de `court_tracking_strategies` para TJAM em `supabase/seed.sql`.
- **Somente se DJ-8 = "ajustar a A":** `0024` com `submit_collection_failure` ganhando
  `not_found` como não-contabilizável para auto-pausa (alteração aditiva de lógica, mesma
  assinatura). Evitável se o adapter tratar `not_found` como resultado vazio.

**Frontend**

- Nada obrigatório. Opcional/aditivo: exibir `dataHoraUltimaAtualizacao` no painel (exigiria
  persistir o campo — decidir depois de B).

**Testes**

- Vitest do `@juriflow/adapter-datajud` (unidade + integração com `runCollection`, §24).
- `deno test` do handler `collector-datajud` (RPC + fetch stubados).
- `scripts/datajud-smoke.mjs` — smoke manual contra a API real (fora do CI).
- Reexecutar `npm test`, `npm run test:web`, `npm run db:test`, `npm run lint`, `npm run
  build`, `supabase db reset` — devem continuar 100% verdes; migrations `0001`–`0021`
  inalteradas.

**Não faz parte de B:** `collector-worker`, adapters TJAM/Projudi/scraper, Supabase Vault,
notificações, `notification_rules`, WhatsApp/WAHA, TPU completa (Fase 4), filtro
`p_source_kinds` no `claim` (Fase C).

---

## Fontes oficiais

- [API Pública — Datajud Wiki (CNJ)](https://datajud-wiki.cnj.jus.br/api-publica/)
- [Acesso / Chave Pública — Datajud Wiki](https://datajud-wiki.cnj.jus.br/api-publica/acesso/)
- [Endpoints — Datajud Wiki](https://datajud-wiki.cnj.jus.br/api-publica/endpoints/)
- [Exemplo 1 — pesquisa por número de processo](https://datajud-wiki.cnj.jus.br/api-publica/exemplos/exemplo1/)
- [Exemplo 2 — pesquisa por classe e órgão julgador](https://datajud-wiki.cnj.jus.br/api-publica/exemplos/exemplo2/)
- [Exemplo 3 — paginação com search_after](https://datajud-wiki.cnj.jus.br/api-publica/exemplos/exemplo3/)
- [Termo de Uso da API Pública — Datajud Wiki](https://datajud-wiki.cnj.jus.br/api-publica/termo-uso/)
- [Termo de Uso da API Pública do Datajud v1.1 (PDF, CNJ)](https://formularios.cnj.jus.br/wp-content/uploads/2023/05/Termos-de-uso-api-publica-V1.1.pdf)
- [API Pública do DataJud — Portal CNJ](https://www.cnj.jus.br/sistemas/datajud/api-publica/)
