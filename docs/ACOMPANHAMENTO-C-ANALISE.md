# JuriFlow — Acompanhamento-C: orquestração/worker (Análise técnica)

> **Somente análise.** Nenhuma migration, Edge Function, worker, adapter, alteração de RPC,
> alteração de RLS, alteração em `processes`/`courts`, alteração no `collector-engine` ou no
> frontend foi feita para produzir este documento. Nenhum commit. Este documento é para
> **aprovação** antes de qualquer implementação.
> **Base:** commit `669f585` (branch `feat/acompanhamento-processos`), working tree limpo.
> **Data:** 2026-09-04

## Legenda

| Marca | Significado |
|---|---|
| ✅ **CONFIRMADO NO CÓDIGO** | Verificado lendo o código/schema real do commit `669f585`. |
| 🔵 **INFERÊNCIA TÉCNICA** | Decorre logicamente do código confirmado, mas não é uma afirmação literal dele. |
| 🟡 **DECISÃO PROPOSTA** | Recomendação desta análise — não implementada, não aprovada. |
| 🔴 **NÃO CONFIRMADO / PENDENTE** | Depende de escolha de produto, infraestrutura ou de algo que só se sabe na prática. |

---

## 1. Objetivo

Decidir **se, e como**, o JuriFlow precisa de uma camada de orquestração/execução desacoplada
das RPCs da Acompanhamento-A e do runtime HTTP da Acompanhamento-B — a chamada
"Acompanhamento-C" prevista desde a análise original (`docs/ACOMPANHAMENTO-ANALISE.md`,
§2, §4.3, DP-A) para fontes que uma Edge Function **não** consegue atender (sessão
autenticada, navegador headless, retries longos — RT-23/RT-C daquela análise) e para fechar
a lacuna, já identificada nas revisões pré-commit de A+B, de **runs `collection_runs`
órfãs em `status = running`** sem nenhum mecanismo de recuperação.

Este documento não implementa nada. Produz um veredito e uma lista de decisões que precisam
da sua aprovação explícita antes de qualquer código.

---

## 2. Estado atual (reconstrução a partir do código real)

### 2.1 Pipeline ponta a ponta hoje

```
pg_cron 'juriflow-tracking-sweep' (*/10 * * * *)              [0021, guardado]
        │
        ▼
app.tracking_sweep()  [SECURITY DEFINER, search_path='']       ✅
        │  insere job_runs('tracking_sweep','running')
        │  v_ids := array(select app.tracking_due_config_ids())
        │  para cada id: insert collection_runs(status='pending', trigger='scheduled', attempt=1)
        │                update process_tracking_configs.next_run_at
        │  atualiza job_runs → 'success'/'failed' com stats {due, queued}
        ▼
collection_runs (status='pending')  ── fila durável, sem fila externa ──
        │
        │  ⬇ ninguém mais "empurra" — a partir daqui é PULL
        │
pg_cron 'juriflow-collector-datajud' (*/5 * * * *)             [0023, guardado, no-op se GUC vazia]
        │  net.http_post(url = app.collector_datajud_url, Bearer = app.collector_invoke_secret)
        ▼
Edge Function collector-datajud (Deno)                          ✅ [Acompanhamento-B]
        │  handle() → fail-closed (503 sem secret) → runDataJudCollector()
        ▼
runDataJudBatch()  [packages/adapter-datajud/src/runtime.ts]    ✅
        │  loop até maxRuns=20, sleep(600ms) ENTRE runs (não durante):
        │
        ├─▶ claim_pending_collection_run()  [SECURITY DEFINER, service_role]      ✅
        │       SELECT ... FOR UPDATE OF r SKIP LOCKED
        │       WHERE status='pending' AND queued_at<=now() AND config não pausada
        │             AND NOT EXISTS (mesma process_id+source_kind em 'running')
        │       ORDER BY queued_at LIMIT 1
        │       → marca 'running', started_at=now(); devolve JSON (run_id, cnj_number,
        │         court_id, source_params, is_first_sync, since, state_hash_before, known[])
        │
        ├─▶ DataJudAdapter.fetch()  (fixo — NÃO passa por SourceRegistry)          ✅
        │
        ├─▶ runCollection()  [@juriflow/collector-engine, puro]                    ✅
        │       normalizeMovement + detectChanges → movements[], events[], stateHash
        │
        └─▶ submit_collection_result() / submit_collection_failure()               ✅
                [SECURITY DEFINER, service_role; exige status='running' — senão raise]
                grava process_movements, process_change_events, process_tracking_state,
                atualiza collection_runs e process_tracking_configs (backoff/auto-pausa)
```

### 2.2 Quem é dono de quê (confirmado)

| Camada | Onde | Fonte |
|---|---|---|
| Contratos (`ProcessDataSource`, `SourceRegistry`, `RawMovement`) | `packages/collectors-core` | A (imutável) |
| Motor puro (`runCollection`, `classifyError`) + laço de referência `runCollectorTick` | `packages/collector-engine` | A |
| Normalização + detecção (`content_hash`, `detectChanges`) | `packages/movement-normalizer` | A |
| Modelo de dados + RLS + RPCs (`claim_*`/`submit_*`/`set_process_tracking`/`collect_process_now`) | `supabase/migrations/0016–0021` | A |
| Scheduler de enfileiramento (`tracking_sweep`, `pg_cron` a cada 10 min) | `0021` | A |
| **Único adapter real** (`DataJudAdapter`) | `packages/adapter-datajud` | B |
| **Único runtime real** (Edge Function + seu próprio `pg_cron`/`pg_net`) | `supabase/functions/collector-datajud`, `0022`/`0023` | B |
| Orquestração multi-fonte, recuperação de falha de processo/host, throughput entre fontes | — **não existe** — | **C** |

### 2.3 O achado central desta análise ✅

`claim_pending_collection_run()` **não filtra por `source_kind`** — reclama a run `pending`
mais antiga de **qualquer** fonte (confirmado lendo `0021`, função sem parâmetros). E
`runDataJudBatch()` (B) **não usa `SourceRegistry`**: recebe uma única instância fixa de
`DataJudAdapter` no construtor e a repassa a `runCollection` **independente do
`source_kind` que veio no claim** (`runtime.ts`, `source: deps.source`).

Isso funciona hoje porque só existe uma `court_tracking_strategies` habilitada
(`datajud`/TJAM, semeada em `seed.sql`). Mas nada no schema impede o SUPER_ADMIN de cadastrar
hoje mesmo uma estratégia com `source_kind='projudi_tjam'` — a partir daí `tracking_sweep`
enfileiraria normalmente essas runs, e a Edge Function do DataJud as reclamaria (claim não
filtra) e tentaria processá-las com o `DataJudAdapter` errado. O `resolveStrategy` do
handler está fixo em `eq('source_kind','datajud')`, então o resultado seria uma
`CollectionError('unknown', 'Sem estratégia DataJud habilitada...')` — falha classificada,
sem corrupção, mas **semanticamente errada**: uma run de outra fonte seria retentada e
auto-pausada com um erro rotulado "DataJud". 🔵

**Este é o problema real que C precisa resolver**, não uma necessidade abstrata de "ter um
worker": falta, em produção, o componente que (a) reclama runs de qualquer fonte e despacha
para o adapter certo via `SourceRegistry` (que já existe e já faz isso em
`runCollectorTick`, mas não é usado em produção — só em `scripts/collector-tick.mjs` e nos
testes ✅), e (b) sabe rodar fontes que uma Edge Function não aguenta.

### 2.4 O que já é sólido e C não deve tocar ✅

- `collection_runs_running_uniq` — índice único parcial `(process_id, source_kind) WHERE
  status='running'` — impede duas execuções simultâneas do mesmo par.
- `FOR UPDATE OF r SKIP LOCKED` em `claim_pending_collection_run` — múltiplos chamadores
  concorrentes já reclamam linhas distintas sem bloquear uns aos outros.
- `submit_collection_result`/`submit_collection_failure` exigem `status='running'` — uma
  segunda submissão para a mesma run é rejeitada.
- Backoff fixo 5m/15m/1h/3h/6h, tentativa máx. 5 (`collection_runs_attempt_chk`), auto-pausa
  após 5 falhas consecutivas — tudo em `submit_collection_failure`, inalterado por B.
- `movement_categories`/`content_hash`/`process_movements` unique — inalterados por B,
  não tocados por esta análise.

---

## 3. Problema que C resolve

1. **Dispatch multi-fonte ausente em produção.** `SourceRegistry` existe e funciona
   (`registry.spec.ts`, `runCollectorTick`), mas nenhum runtime real o usa hoje. B contornou
   isso fixando um único adapter porque só havia uma fonte — decisão correta para o escopo
   de B, mas não escala para uma segunda fonte sem C.
2. **Fontes que a Edge Function não executa.** `docs/ACOMPANHAMENTO-ANALISE.md` §4.3/RT-C
   já havia concluído: TJAM/Projudi e scrapers exigem sessão autenticada, navegador
   headless e retries longos — incompatível com o runtime Deno de curta duração de uma Edge
   Function. 🔵 Isso continua verdadeiro e é a justificativa técnica mais forte para um
   processo persistente.
3. **Runs órfãs sem recuperação.** Confirmado: nenhuma coluna de lease/heartbeat, nenhum
   reaper, nenhum `p_source_kinds` existe no schema (`grep` por `lease|heartbeat|worker|
   reaper|p_source_kinds` nas migrations só encontra comentários). Se o processo que
   reclamou uma run morre entre o `claim` e o `submit`, a run fica `running` para sempre —
   `tracking_due_config_ids` exclui explicitamente `(process_id, source_kind)` com run
   `pending`/`running`, então aquele par fica **travado** até intervenção manual. ✅
4. **Throughput justo entre fontes.** Sem despacho por `source_kind`, uma fila global FIFO
   por `queued_at` (como é `claim_pending_collection_run` hoje) não separa "DataJud rápido"
   de "scraping lento" — uma fonte lenta pode atrasar as demais assim que existir mais de
   uma fonte real.

**O que C não resolve nem deveria tentar resolver:** nada do exposto acima é culpa do
`collector-engine`, do `movement-normalizer` ou das RPCs — todos continuam corretos e
agnósticos de fonte. O problema é inteiramente de **orquestração/runtime**, a camada que
falta.

---

## 4. Alternativas avaliadas

| Alternativa | Avaliação |
|---|---|
| **Mais uma Edge Function** (uma por fonte, como B fez para DataJud) | Funciona para chamadas HTTP/JSON curtas. **Não serve** para scraping/headless (sem Chromium no Deno Edge, wall-clock curto, sem sessão persistente entre invocações) — RT-C da A. |
| **Processo Node persistente** (serviço sempre ativo) | Pode rodar Playwright/Puppeteer, manter sessão/cookies, fazer backoff em memória, ter seu próprio loop de polling (sem depender de `pg_net`). É o `services/collector-worker` já previsto na análise original (DP-A). **Recomendado.** |
| **Container Docker** | Não é uma alternativa de *execução*, é a forma de *hospedar* a opção anterior. Decisão de infraestrutura (onde rodar — Fly.io/Railway/VM/K8s) continua em aberto (herda a DP-A da A, nunca resolvida). 🔴 |
| **Job runner externo** (ex.: BullMQ+Redis, Graphile Worker) | Introduziria uma **segunda fila** paralela a `collection_runs`, com risco real de dessincronia entre o estado da fila externa e o estado em `collection_runs` (quem é a fonte da verdade?). `collection_runs` já funciona como fila durável com `SKIP LOCKED` — não há ganho que justifique o novo ponto de falha. **Rejeitado.** |
| **cron + worker** (worker acionado externamente por cron, como B faz com a Edge Function) | Funciona, mas herda o mesmo risco que B tem: se um lote demorar mais que o intervalo do cron, invocações podem se sobrepor (nada garante execução única). Um processo persistente com **loop interno** evita esse problema por construção. |
| **Fila explícita** (ex.: `pgmq`) | Substituiria o modelo `pending/running` de `collection_runs` por uma fila formal — **alteração estrutural** em cima de uma tabela da A, sem necessidade demonstrada (o padrão atual já é uma fila funcional). **Rejeitado agora**, coerente com a escolha já feita em A para `process_change_events` (DP-I: tabela, não fila). |
| **Polling de `collection_runs`** | É exatamente o que já acontece (B via reinvocações da Edge Function; qualquer worker faria o mesmo via seu próprio loop). **Correto — não substituir, estender.** |

---

## 5. Arquitetura recomendada 🟡

Um **processo Node persistente** (`services/collector-worker`, nome já previsto na análise
original), hospedado em container, que:

1. Roda **N "lanes" de claim concorrentes** (configurável), cada uma com seu próprio loop
   `claim → dispatch(SourceRegistry) → runCollection → submit`, sem depender de
   `pg_cron`/`pg_net` para se autoacionar (loop interno com `setInterval`/backoff próprio).
2. Resolve o adapter pelo `source_kind` retornado pelo `claim` via `SourceRegistry` —
   igual ao que `runCollectorTick` (A) já faz — em vez de um adapter fixo como B.
3. Aplica espaçamento/concorrência **por fonte** (o padrão que B validou para DataJud,
   generalizado), para que uma fonte lenta não starve as demais.
4. Roda um **reaper** periódico (função SQL nova, chamada em loop pelo próprio worker ou
   por um `pg_cron` dedicado) que reclama runs `running` órfãs.
5. **Não tem endpoint HTTP público** por padrão — só faz chamadas de saída (Postgres via
   `service_role`/RPC; a fonte via HTTP ou navegador). Isso elimina de saída a superfície de
   ataque que B precisou fechar com o *fail-closed* de `COLLECTOR_INVOKE_SECRET` — não há
   porta de entrada para proteger.

**Sobre o DataJud:** decisão explicitamente **não tomada aqui** (ver §16, DP-C2) — a
recomendação é manter o DataJud exatamente onde está (Edge Function B, já validada, já em
produção) e usar C apenas para fontes que a Edge Function não atende. Migrar o DataJud para
o worker é possível depois, sem pressa, se a operação preferir um único runtime.

**Reuso, não reimplementação:** o par `claim`/`submit` e `runCollection` **não mudam**. O
worker deve reaproveitar `runCollectorTick` (ou uma variante aditiva dele) como o "miolo" de
cada lane, evitando criar uma terceira implementação do mesmo laço (depois de
`runCollectorTick` e `runDataJudBatch`) — ver §14.

---

## 6. Fluxo completo (proposto)

```
collector-worker (processo Node, container, N lanes configuráveis)
  │
  ├─ lane 1..N: loop interno (sem pg_net)
  │     while true:
  │       claim = claim_pending_collection_run(p_source_kinds?)   ← DP-C3
  │       if claim is null: sleep(poll_interval); continue
  │       source = registry.create(claim.source_kind)             ← SourceRegistry (A)
  │       outcome = runCollection({ source, ...claim })            ← inalterado (A)
  │       submit_collection_result(...) | submit_collection_failure(...)  ← inalterado (A)
  │       sleep(spacing_por_fonte[claim.source_kind])
  │
  └─ reaper (própria função SQL, chamada periodicamente)
        select ids de collection_runs
          where status='running' and started_at < now() - reaper_timeout
        para cada id: submit_collection_failure(id, {error_code:'timeout',
          error_message:'Execução expirou sem resposta do worker.', retriable:true})
        → reusa INTEGRALMENTE a lógica de backoff/auto-pausa já existente
```

Nenhuma etapa deste fluxo cria um mecanismo paralelo: o reaper **chama a RPC existente**
com um erro sintético, em vez de duplicar a lógica de backoff/auto-pausa.

---

## 7. Concorrência

| Cenário | Situação hoje | Ação de C |
|---|---|---|
| Múltiplos chamadores concorrentes reclamando runs | ✅ Já seguro — `FOR UPDATE OF r SKIP LOCKED` garante que cada chamador pega uma linha distinta, sem bloqueio. Vale para N Edge Functions sobrepostas ou N lanes de um worker. | Nenhuma mudança necessária na RPC para este ponto. |
| Duas execuções para o mesmo `(process, source)` | ✅ Impedido em 3 camadas: `tracking_due_config_ids` não enfileira se já há `pending`/`running`; `claim` só pega quem não tem run `running` para o par; `collection_runs_running_uniq` garante no nível do banco. | Nenhuma mudança. |
| Duas fontes para o mesmo processo (ex.: `datajud` + `projudi_tjam` simultâneas) | ✅ Permitido e intencional — `process_tracking_configs` é `unique(process_id, source_kind)`, cada fonte tem seu próprio estado (`process_tracking_state`) e suas próprias movimentações (`process_movements` é `unique(process_id, source_kind, content_hash)` — o mesmo texto em duas fontes gera hashes diferentes, não são deduplicadas entre si). | Comportamento correto de design; não é bug, não muda. |
| Worker reclama uma run de fonte que ele não sabe processar | 🔴 Hoje não acontece porque só existe uma fonte. **No dia em que existir uma segunda fonte, isso é um risco real**: `claim` não filtra por `source_kind`, então uma lane só-scraping pode reclamar uma run `datajud` (ou vice-versa) e falhar por "adapter não registrado". | 🟡 **Decisão central (DP-C3):** filtrar o `claim` por `source_kind` (parâmetro aditivo `p_source_kinds text[] default null`, `null` = comportamento atual). Sem isso, cada lane precisa tratar "não sei processar essa fonte" como falha não-retriável e sempre chamar `submit_collection_failure` antes de continuar — funciona, mas desperdiça o slot e pode disparar backoff/auto-pausa indevidos. |
| Comportamento após crash do worker | ❌ Run fica `running` para sempre — sem reaper, sem lease, sem timeout. Confirmado: nenhuma dessas colunas/mecanismos existe hoje. | 🟡 Ver §8 — reaper proposto. |
| Lease/heartbeat | ❌ Não existe. | 🟡 Ver §8 — proposto como evolução futura, não no corte inicial. |

---

## 8. Leases / Reaper

### 8.1 Diagnóstico ✅

`collection_runs` tem `started_at`/`finished_at`, mas **nenhuma** coluna de lease, heartbeat
ou dono da execução. `claim_pending_collection_run` marca `running` e devolve o payload; daí
em diante, o banco não tem mais nenhuma visibilidade sobre se o processo que reclamou a run
ainda está vivo.

### 8.2 Duas soluções possíveis

**(a) Reaper por timeout fixo — 🟡 recomendado para o corte inicial**
- Nova função SQL (`app.reap_orphaned_collection_runs()` ou similar) que seleciona
  `collection_runs` com `status='running' AND started_at < now() - <limiar>` e, **para cada
  uma**, chama `submit_collection_failure(id, {error_code:'timeout', retriable:true, ...})` —
  reaproveita 100% da lógica de backoff/retry/auto-pausa já existente, sem duplicar nada.
- Simples de implementar e testar. Correto para fontes HTTP curtas (DataJud: timeout do
  adapter é 30s por padrão — uma run legitimamente `running` não deveria durar muito mais
  que isso mais a margem de rede).
- **Fraqueza:** não distingue "run genuinamente lenta" de "worker morto" — só sabe o tempo
  decorrido. Para uma fonte HTTP com timeout de adapter conhecido, isso é seguro (o limiar do
  reaper pode ser generosamente maior que o timeout do adapter). Para scraping (sessões que
  podem legitimamente levar minutos), um timeout fixo arrisca matar execuções válidas.

**(b) Lease/heartbeat — 🟡 proposto para quando existir uma fonte genuinamente longa**
- Colunas aditivas em `collection_runs`: `lease_expires_at timestamptz`, talvez
  `leased_by text` — o processo que está executando renova o lease periodicamente; o reaper
  reclama só quem o lease expirou, não quem "está demorando".
- Mais correto, mais caro de construir/testar (exige heartbeat no worker, mais uma RPC ou
  atualização direta sob `service_role`).
- Reservar para quando C precisar rodar scraping de verdade — não é necessário para
  destravar o gap de hoje (que só afeta DataJud, uma fonte com timeout curto e conhecido).

### 8.3 Recomendação 🟡

Implementar **(a)** primeiro — cobre o gap real e existente hoje (DataJud) com baixo risco e
baixa complexidade. Migrar para (b) apenas se/quando uma fonte de longa duração (scraping)
justificar. Isso é uma **decisão pendente** (DP-C4) — inclusive o valor do limiar (proposta:
alguns minutos para fontes HTTP; recalibrar quando scraping existir).

### 8.4 Onde o reaper roda 🟡

Pode ser um passo a mais dentro de `tracking_sweep` (mistura enfileiramento com limpeza) ou
uma função/`pg_cron` **separados**, com seu próprio `job_runs` (melhor separação de
responsabilidade e observabilidade independente — recomendado, DP-C5).

---

## 9. Idempotência

Prova por inspeção do código real, ponto a ponto solicitado:

| Momento do crash | O que sobrevive | Por quê |
|---|---|---|
| **Depois do `fetch`, antes do `runCollection`** | Nada foi persistido. Run fica `running` (órfã). | `runCollection` é puro/em memória (`packages/collector-engine/src/engine.ts`) — não grava nada até `submit_*` ser chamado. ✅ |
| **Depois do `runCollection`, antes do `submit`** | Idêntico ao anterior — o resultado só existe na memória do processo que morreu. | Mesma razão. ✅ |
| **Durante o `submit` (RPC interrompida no meio)** | **Nada é aplicado parcialmente.** `submit_collection_result`/`submit_collection_failure` são uma única invocação PL/pgSQL — sem `COMMIT`/savepoints internos — então o Postgres reverte a chamada inteira se a sessão cair no meio. A run permanece no último estado durável (`running`). | ✅ Confirmado lendo o corpo das duas funções em `0021` — nenhum controle de transação explícito dentro delas. |
| **Retry (após reaper ou falha normal)** | Uma **nova** linha em `collection_runs` (`attempt+1`, `trigger='retry'`) é claimada depois; `claim_pending_collection_run` recalcula `known`/`is_first_sync`/`state_hash_before` **lendo o estado real do banco**, nunca confiando em estado em memória de uma tentativa anterior. | ✅ |
| **Duas submissões para a mesma run** (worker duplicado, retry indevido) | A segunda é **rejeitada**: `select ... for update; if v_run.status <> 'running' then raise exception`. | ✅ Confirmado no início de ambas as RPCs. O worker precisa tratar essa exceção sem derrubar o loop inteiro (log + segue para a próxima run) — requisito de implementação, não de schema. |
| **Movimentação duplicada** | Impossível mesmo em reenvio: `process_movements` é `unique(process_id, source_kind, content_hash)` com `on conflict do nothing` dentro de `submit_collection_result`. | ✅ |
| **`content_hash`/`source_movement_id`** | Calculados inteiramente em `movement-normalizer` (puro, pré-C). C não toca nisso. | ✅ Confirmado — nenhuma proposta desta análise altera `normalize.ts`/`hash.ts`/`detect.ts`. |

**Conclusão:** o desenho de A já é seguro contra crash em qualquer ponto do laço — a
propriedade central é que `submit_*` é atômico e exige `status='running'`. C não precisa
(e não deve) inventar nada aqui; só precisa **detectar e reenfileirar** o caso "morreu antes
de conseguir chamar `submit_*`" — que é exatamente o papel do reaper (§8).

---

## 10. Throughput / rate limiting / fairness

- **DataJud (120 req/min compartilhado):** fica de fora do worker se DP-C2 mantiver B como
  está — o limite já é gerenciado pelo espaçamento de `runDataJudBatch` (~600 ms entre
  chamadas). 🔵 Ponto lateral observado (não é escopo de C corrigir, mas é relevante para o
  desenho): como o cron da B (`0023`, a cada 5 min) reaciona a Edge Function
  independentemente de a invocação anterior ter terminado, um lote de 20 runs mais lento que
  o normal poderia se sobrepor à próxima invocação — um processo persistente com loop
  **interno** (como o worker de C) evita essa classe de problema por construção, o que é mais
  um argumento a favor da arquitetura recomendada.
- **Rate limit por fonte, não global:** cada fonte tem seu próprio limite (DataJud = cota
  nacional; scraping = risco de captcha/bloqueio por excesso de sessões do mesmo IP). O
  worker deve tratar espaçamento/concorrência **por `source_kind`**, não um número único
  global. `court_tracking_strategies.params` (jsonb) já é o lugar natural para guardar isso
  por estratégia (ex.: `max_concurrent`, `min_spacing_ms`) — extensão aditiva de uma coluna
  que já existe, sem migração estrutural. 🟡
- **Fairness entre espaços/tribunais:** `claim_pending_collection_run` usa `ORDER BY
  queued_at LIMIT 1` — FIFO estrito por fila global. Como o `sweep` distribui `next_run_at`
  com jitter de até 15 min (`app.compute_next_run_at`, já existente), nenhum espaço/tribunal
  deveria dominar a fila em regime estável. ✅ (mecanismo de jitter) + 🔵 (conclusão sobre
  fairness resultante).
- **Impacto de uma fonte lenta sobre as demais:** **sem** filtro por `source_kind` no
  `claim`, sim — um backlog de uma fonte lenta pode atrasar a reclamação de runs de outra
  fonte, porque a fila é única e global. Isso reforça DP-C3 (`p_source_kinds`) como a decisão
  técnica mais importante desta análise: sem ela, "lanes por fonte" não é possível de forma
  limpa — cada lane teria que reclamar qualquer coisa e descartar (com custo de um
  `submit_collection_failure` espúrio) o que não sabe processar.
- **A solução não pode ser "aumentar concorrência".** Mais lanes não ajudam em nada se a
  fila continuar sendo uma só, sem separação por fonte — só aumentaria a chance de uma lane
  "roubar" uma run de outra fonte que ela não processa.

---

## 11. Erros / retry

Nenhuma classe nova é necessária. C reusa integralmente `@juriflow/collector-engine/errors.ts`
(`CollectionError`, `classifyError`) — o mesmo contrato que B já usa. ✅

| Situação | Classe/código já existente | Retriável | Origem |
|---|---|---|---|
| timeout, 5xx, erro de rede | `timeout`/`unavailable` | sim | adapter (já implementado em B para DataJud) |
| 429 | `rate_limited` | sim | adapter |
| 401/403 | `auth_failed` | não | adapter |
| parse/JSON inválido | `parse_error` | não | adapter |
| "não encontrado" | tratamento é decisão do **adapter** (B escolheu resultado vazio + sucesso — DJ-8); um adapter futuro pode escolher `not_found` (código já existe no enum `collection_error_code`) se fizer sentido para aquela fonte | depende do adapter | adapter |
| **falha interna / crash do worker** | **Não é um `CollectionError`** — `runCollection` nunca terminou. É exatamente o caso que o reaper cobre, reusando o código `timeout` já existente (`collection_error_code` já tem esse valor) com uma mensagem que deixa claro que foi o reaper, não o adapter, que classificou. | sim (mesmo caminho de backoff) | **novo, mas é um novo CAMINHO até uma RPC existente, não um novo código.** |

Nada aqui exige alterar `collector-engine/src/errors.ts`.

---

## 12. Observabilidade

| Tabela/mecanismo | Uso hoje | Proposta para C |
|---|---|---|
| `job_runs` | Só `tracking_sweep` grava (`job_name='tracking_sweep'`, stats `{due, queued}`). B **não** grava (gap já registrado na revisão pré-commit A+B, item D-2, adiado). RLS: só `is_super_admin()` lê. ✅ | Cada "tick"/lote do worker grava uma linha (`job_name='collector_worker_tick'`) com `stats jsonb = {claimed, success, failed, empty, retry_queued, rate_limited, auth_failed}`. O reaper grava a sua própria (`job_name='collector_reaper'`, `stats={reaped:N}`) — dá visibilidade de reaping recorrente (sintoma de host instável) separada do throughput normal. 🟡 |
| `collection_runs` | Já é o registro por execução (status, `error_code`, `duration_ms`, contagens). ✅ | Suficiente como está para drill-down por run; nenhuma coluna nova necessária no corte inicial (viraria necessária só se DP-C4 optar por lease/heartbeat). |
| Logs estruturados | B já segue o padrão `logger(level, message, ctx)` sem segredos, testado (2 testes dedicados garantem que a API key nunca vai a log). ✅ | Worker deve seguir a mesma disciplina; onde os logs vão depende da hospedagem (decisão de infra, DP-C1). |
| Métricas dedicadas (Prometheus etc.) | Não existe. | 🟡 Proposta: **não construir agora** — `job_runs` + `collection_runs` já respondem "o sistema está saudável?" para o volume atual. Revisitar só se houver sinal operacional real de necessidade. |

**Mínimo necessário para produção (proposta):** `job_runs` enriquecido (claimed/success/
failed/empty/retry/rate_limited/auth_failed) por tick do worker + entrada própria do reaper
com contagem de runs órfãs reclamadas. Isso é suficiente para operar sem instrumentação
adicional. 🟡

---

## 13. Segurança

| Item | Situação |
|---|---|
| `service_role` | O worker precisaria da mesma `SUPABASE_SERVICE_ROLE_KEY` que B usa hoje — mesma disciplina de nunca aparecer em código/log/frontend. |
| Acesso às RPCs | `claim_pending_collection_run`/`submit_collection_result`/`submit_collection_failure` já são `revoke ... from public` + `grant ... to service_role` (confirmado, `0021`). O worker usaria as mesmas concessões — nenhuma mudança de grant necessária, **exceto** se `p_source_kinds` for aprovado (mesma função, mesmo grant, só um parâmetro novo com default). |
| **Princípio do menor privilégio** | 🔴 **Ainda em aberto desde a A** — DP-S ("Acesso do worker ao banco: `service_role` vs. role dedicada com grants mínimos... proposta: role dedicada, se viável") nunca foi resolvida. `service_role` dá bypass total de RLS; uma role dedicada com `EXECUTE` só nas 3–4 funções que o worker realmente chama reduziria o raio de dano de um worker comprometido. Nem A nem B implementaram a alternativa — decisão pendente, não resolvida aqui. |
| **Exposição do worker** | Ao contrário de B (Edge Function = endpoint HTTP público, precisou de *fail-closed* explícito), um worker de polling **não tem nenhuma porta de entrada por padrão** — só faz chamadas de saída. Isso é uma vantagem de segurança estrutural da arquitetura recomendada, não uma correção necessária. Se um endpoint de *health check* for adicionado depois, ele precisa da sua própria autenticação — fora do escopo aqui. |
| Credenciais no banco/frontend | Inalterado. `court_tracking_strategies.params` continua sem segredo. Um adapter futuro com login (TJAM/Projudi) vai precisar de armazenamento de credencial próprio (Vault ou secret do host) — **explicitamente fora do escopo desta análise** (nenhum adapter de scraping está sendo desenhado aqui). |
| SUPER_ADMIN e dados operacionais | Inalterado — `job_runs` continua só para `is_super_admin()`; `collection_runs`/`process_movements` continuam via `app.can_read_process` (ADMIN do espaço OU responsável); nenhuma alteração de RLS é proposta ou necessária. |

---

## 14. Impacto arquitetural (classificação por item)

| Mudança futura (se aprovada) | Classificação | Observação |
|---|---|---|
| Worker usar `SourceRegistry` em vez de adapter fixo | **Aditiva** | Novo consumidor de um contrato já existente e inalterado (`collectors-core`). |
| `p_source_kinds text[] default null` em `claim_pending_collection_run` | **Aditiva** (assinatura compatível; `default null` preserva todo chamador atual sem argumento — B e `scripts/collector-tick.mjs` continuam funcionando sem mudança) | **Ainda assim é uma alteração de RPC da A** — precisa de aprovação explícita antes de codificar, mesmo sendo aditiva. |
| Reaper (nova função SQL + novo `pg_cron`) | **Aditiva** | Não modifica nenhuma função/tabela existente; só chama `submit_collection_failure` (já existe) em loop. |
| Colunas de lease/heartbeat em `collection_runs` (se DP-C4 escolher a opção b) | **Aditiva** (colunas novas, `nullable`, sem migração de dados) | Toca uma tabela da A — precisa de aprovação explícita, mesmo sendo aditiva. |
| Mais gravações em `job_runs` (worker, reaper) | **Aditiva** | Mesmo padrão de insert já usado por `tracking_sweep`. |
| Reaproveitar/estender `runCollectorTick` do `collector-engine` | **Aditiva se for extensão** (novo parâmetro opcional ou nova função exportada ao lado da existente); **risco de regressão se for reescrita** | Recomendação: **não reescrever nem apagar** `runCollectorTick`/`runDataJudBatch` agora — o mesmo princípio já aplicado na revisão pré-commit de A+B ("não mexer na arquitetura por perfeccionismo") vale aqui. |
| RLS | **Nenhuma mudança** | Nenhum desenho desta análise precisa de nova política ou de alterar as existentes. |
| `processes`/`courts` | **Nenhuma mudança** | Confirmado que nenhuma proposta aqui toca essas tabelas. |
| Frontend | **Nenhuma mudança** | `tracking.service.ts` só lê `court_tracking_strategies`/`process_tracking_configs`/`collection_runs`/`process_movements` e chama `set_process_tracking`/`collect_process_now` — nada disso muda com C. ✅ Confirmado lendo o serviço. |

---

## 15. Riscos

| ID | Risco | Severidade | Mitigação |
|---|---|---|---|
| RT-C1 | Starvation entre fontes se C avançar sem `p_source_kinds` (DP-C3) | Média-Alta (só materializa quando existir uma 2ª fonte) | Aprovar DP-C3 antes de registrar qualquer segunda fonte real |
| RT-C2 | Reaper mal calibrado — timeout curto mata execução legítima; timeout longo deixa run presa por muito tempo | Média | Calibrar por tipo de fonte (DP-C4); começar conservador para DataJud, revisar quando scraping existir |
| RT-C3 | `service_role` de escopo total no worker (DP-S da A, ainda aberta) | Média | Avaliar role dedicada antes do worker ir a produção com uma fonte credenciada |
| RT-C4 | Infraestrutura de hospedagem indefinida (DP-A da A, ainda aberta) | Alta (bloqueia o "onde roda") | Decisão de produto/infra necessária antes de qualquer implementação |
| RT-C5 | Terceira implementação duplicada do laço claim/run/submit | Baixa-Média | Reusar `runCollectorTick` como base das lanes (§14) |
| RT-C6 | Overlap de invocações (padrão que B já tem com o cron da Edge Function) sendo repetido no desenho de C | Baixa | Loop interno no worker evita esse padrão por construção (§5, §10) |
| RT-C7 | Escopo crescer para scraping/credenciais/Vault "aproveitando que já estamos mexendo aqui" | Média | Fora do escopo explícito desta fase (§19) |

---

## 16. Decisões pendentes (aguardando sua aprovação)

| # | Decisão | Recomendação desta análise |
|---|---|---|
| **DP-C1** | Forma do runtime: worker Node persistente em container (vs. as alternativas do §4)? Onde hospedar (retoma a **DP-A** nunca resolvida da Acompanhamento-A)? | Worker persistente; hospedagem em aberto — precisa de decisão de infra |
| **DP-C2** | DataJud continua **exclusivamente** na Edge Function (B), e C só cobre fontes que a Edge Function não atende? Ou C também assume DataJud e a Edge Function é aposentada? | Manter B como está; C cobre o que falta |
| **DP-C3** | Adicionar `p_source_kinds text[] default null` a `claim_pending_collection_run` (aditivo, mas é alteração de RPC da A) | Aprovar — é o ponto técnico mais importante para throughput justo entre fontes |
| **DP-C4** | Reaper: timeout fixo (corte inicial) vs. lease/heartbeat (mais correto para scraping futuro)? Qual o valor do limiar? | Timeout fixo agora; valor a definir (proposta: poucos minutos para fontes HTTP) |
| **DP-C5** | Reaper roda dentro do `tracking_sweep` ou como função/cron separados? | Separados — melhor observabilidade independente |
| **DP-C6** | Política de concorrência/fairness: quantas lanes, limites por fonte, limites por espaço/tribunal? | Precisa de números de produto — não decidido aqui |
| **DP-C7** | Acesso ao banco: `service_role` (mais simples, igual à B) ou role dedicada com grants mínimos (retoma a **DP-S** da A)? | Em aberto — recomendo avaliar antes de credenciais entrarem em jogo (scraping) |
| **DP-C8** | Base de código do worker: reusar/estender `runCollectorTick` do `collector-engine`, ou nova implementação? | Reusar/estender — evita uma 3ª implementação do mesmo laço |
| **DP-C9** | Nível mínimo de observabilidade (job_runs enriquecido) antes de ir a produção | Aprovar o mínimo proposto em §12 |
| **DP-C10** | Sequenciamento: construir C agora (só para fechar o gap de reaper/dispatch, sem nenhuma fonte nova pronta) ou esperar até existir de fato uma segunda fonte (scraping) que precise dele? | Decisão de produto — não técnica |

**Nenhuma dessas foi decidida silenciosamente.** Nenhuma migration, RPC ou código foi
alterado para produzir este documento.

---

## 17. Critérios de aceite (para quando C for implementada — não implementado agora)

1. Despacho multi-fonte provado ponta a ponta com ≥ 2 adapters registrados no
   `SourceRegistry` (o `MockSourceAdapter` da A já basta para provar o caminho em teste,
   sem depender de uma segunda fonte real em produção).
2. Runs `running` órfãs são reclamadas dentro da janela configurada do reaper e passam
   pelo backoff/auto-pausa exatamente como uma falha normal (mesmo código, sem caminho
   paralelo).
3. Nenhuma `collection_run` é reclamada duas vezes; nenhuma movimentação/evento é
   duplicado sob teste induzido de crash-e-retry.
4. Uma fonte lenta/com backlog não atrasa o processamento de outra fonte (uma vez que
   DP-C3 exista) — provável em teste.
5. O worker não expõe nenhuma porta HTTP pública (ou, se existir *health check*, está
   protegido).
6. `job_runs`/`collection_runs` respondem "C está saudável agora?" sem precisar ler logs.
7. Toda a suíte de testes de A+B continua verde; nenhuma alteração de RPC quebra chamador
   existente sem preservar o comportamento default.

---

## 18. Escopo de C (uma vez aprovadas as decisões — ainda não autorizado a implementar)

- `services/collector-worker` (Node, container) com `SourceRegistry` + lanes concorrentes
  reaproveitando `runCollectorTick`/uma variante aditiva dele.
- Reaper: nova função SQL (reusa `submit_collection_failure`) + agendamento, conforme
  DP-C4/DP-C5.
- Migration aditiva **somente** se DP-C3 (`p_source_kinds`) e/ou DP-C4 (colunas de lease)
  forem aprovadas.
- Observabilidade mínima: `job_runs` enriquecido por tick + entrada própria do reaper.
- Testes: despacho por `SourceRegistry`, concorrência simulada (múltiplas lanes/`SKIP
  LOCKED`), reaper (crash simulado → reclamado → backoff correto), sem chamada real a
  nenhuma fonte externa.

---

## 19. Fora do escopo (explícito)

Adapters TJAM/Projudi/scraping · notificações · WhatsApp/WAHA · Supabase Vault · TPU
completa · qualquer alteração em `processes`/`courts`/RLS · qualquer alteração no
`DataJudAdapter` ou na Edge Function `collector-datajud` (a menos que DP-C2 decida migrar
DataJud para o worker — não decidido aqui) · reescrita de `collector-engine`/
`movement-normalizer` · Acompanhamento-D.

---

## 20. Veredito

# ⚠️ APTO COM RESSALVAS

A arquitetura recomendada (worker Node persistente + `SourceRegistry` + reaper por timeout
+ observabilidade via `job_runs` enriquecido) é tecnicamente sólida, resolve um problema
real e já demonstrado no código (`claim` sem filtro de fonte + ausência total de reaper),
não exige romper nem reescrever nada de A ou B, e reaproveita a base já testada
(`runCollectorTick`, `SourceRegistry`, `submit_collection_failure`).

A ressalva é que **10 decisões genuínas de produto/infraestrutura** (DP-C1 a DP-C10) —
principalmente hospedagem (herda a DP-A nunca resolvida da A), o parâmetro de despacho por
fonte na RPC (DP-C3) e o modelo de reaper (DP-C4) — precisam de aprovação explícita antes
de qualquer linha de código. Nenhuma delas foi decidida silenciosamente neste documento.

**Aguardo sua aprovação das decisões da seção 16 antes de implementar Acompanhamento-C.**
