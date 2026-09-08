# JuriFlow · Acompanhamento-H · Etapa 8A — Contrato da fonte PROJUDI Consulta Pública TJAM

> **Status:** ✅ **CONCLUÍDA — contrato técnico confirmado.**
> **Data das evidências:** 2026-09-07.
> **Método:** sessão de **navegador real (Edge, dirigido pelo Playwright, canal `msedge`)**
> conduzida pelo responsável — o F5 WAF e o reCAPTCHA (invisível para humano) foram
> passados por interação humana legítima, **sem burlar** anti-bot. Capturados: HTML real do
> formulário, `document.forms` (nomes/opções reais), HTML real da página do processo com a
> aba Movimentações. Complementado por `Carcalto/TJAM-PROJUDI-Consulta` (fluxo autenticado) e
> instalação-irmã do PROJUDI (TJPR).
> **Regra:** o que não pôde ser confirmado por evidência está `NÃO CONFIRMADO`.
> Nenhum endpoint/parâmetro/seletor/cookie/token foi inventado. Nenhum CAPTCHA foi resolvido
> por automação.

> **Histórico:** tentativas anteriores (curl, navegador headless) receberam o desafio JS do
> F5 ou a página "Request Rejected" do F5 ASM — acesso automatizado/headless/datacenter é
> **bloqueado de saída** pelo WAF. Só uma sessão de navegador humano real (IP residencial)
> passa. Isso é um **risco de produção** documentado em §12 (Q2).

---

## 0. Sumário executivo

| | |
|---|---|
| **Fonte** | PROJUDI Consulta Pública de Processos — TJAM (1º grau) |
| **Base URL** | `https://projudi-consulta.tjam.jus.br` |
| **Abrir formulário** | `GET /processo/consultaPublicaNova.do?actionType=iniciar` |
| **Submeter busca** | `POST /processo/consultaPublica.do;jsessionid=<JSESSIONID>?actionType=pesquisar` (form `processoBuscaForm`) |
| **1 resultado** | a resposta do POST **é** a página do processo (HTTP 200; sem 302; sem request separado) |
| **Movimentações** | inline na página do processo — `table.resultTable#idTableMovimentacoesmov1Grau1`; **todas, sem paginação** (69/69 na amostra) |
| **Encoding** | `<meta charset="ISO-8859-1">` **mas os bytes são UTF-8** — decodificar como UTF-8 |
| **Anti-bot** | F5 BIG-IP Advanced WAF (TSPD) + Google reCAPTCHA (invisível p/ humano residencial). Bloqueia acesso automatizado/headless/datacenter. |
| **`Seq.`** | inteiro sequencial por processo — **identificador estável da movimentação** (usar como `source_movement_id`, pendente de Q5) |
| **`Data`** | `DD/MM/AAAA HH:MM:SS` (com segundos) |
| **source_kind recomendado** | `projudi_tjam` (aguardando aprovação — Q3) |
| **Bloqueador restante** | **PP-12** (aval jurídico) permanece PENDENTE — a implementação (8B) não deve começar sem ele. |

---

## 1. Sistema

```text
NOME:      PROJUDI Consulta Pública de Processos — TJAM
           ("PROJUDI - Processo Eletrônico do Judiciário do Amazonas")
URL:       https://projudi-consulta.tjam.jus.br/processo/consultaPublicaNova.do?actionType=iniciar
SISTEMA:   PROJUDI (origem CNJ/TJPR), Java/Struts, contexto web /processo
STATUS:    confirmado (sessão real 2026-09-07)
```

**PROJUDI ≠ e-SAJ.** São dois sistemas do TJAM. Processos migram e-SAJ→PROJUDI; para um
processo migrado, o PROJUDI é a fonte viva.

Existe também um **PROJUDI autenticado** (`https://projudi.tjam.jus.br/projudi/` + login
`#login`/`#senha`/`#btEntrar`, navegação por frames `mainFrame`/`userMainFrame`) — usado pelo
scraper `Carcalto/TJAM-PROJUDI-Consulta`. **NÃO** é a fonte desta etapa (exige credenciais →
DP-13). Só serve de referência de codebase.

---

## 2. Mecanismo de acesso

```text
Mecanismo:               HTTP + HTML server-side (Java/Struts). JS presente mas não
                         obrigatório para o parsing (a tabela vem no HTML).
Autenticação:            NÃO (consulta pública).
Sessão:                  Cookie JSESSIONID (emitido no primeiro GET; aparece no `action`
                         do form como `;jsessionid=<...>`). Cookies TS* do F5 também.
CAPTCHA:                 Google reCAPTCHA (script recaptcha__pt_br.js; campo hidden
                         `g-recaptcha-response`; site key 6Lem7S8tAAAAANmeA_FlCfvDl9ncTByRvecwapFO).
                         Para um humano em IP residencial é INVISÍVEL — nenhum desafio
                         aparece; o token é preenchido pelo JS do Google no submit.
WAF:                     F5 BIG-IP Advanced WAF (TSPD). Serve desafio JS a clientes novos;
                         bloqueia ("Request Rejected") acesso automatizado/headless.
JavaScript obrigatório:  para PASSAR o WAF+reCAPTCHA: sim (um navegador real). Para PARSEAR
                         as movimentações: não (estão no HTML da resposta).
Headless browser:        NÃO funcionou (F5 bloqueia). Navegador real (headed) funciona.
Evidência:               sessão Edge 2026-09-07 — GET consultaPublicaNova.do → challenge TSPD
                         → reload → página real (Google Analytics dispara) → JSESSIONID
                         `ebb91458a5d503f47021f8ea85c5` → POST consultaPublica.do?actionType=pesquisar
                         → 200 com a página do processo.
```

---

## 3. Contrato HTTP

| Etapa | Método | URL | Parâmetros | Resultado |
|---|---|---|---|---|
| abrir formulário | GET | `/processo/consultaPublicaNova.do?actionType=iniciar` | `actionType=iniciar` | HTML do form `processoBuscaForm` + JSESSIONID + reCAPTCHA |
| buscar | **POST** | `/processo/consultaPublica.do;jsessionid=<JSESSIONID>?actionType=pesquisar` | campos do form (§4) | **1 achado:** HTTP 200 com a **página do processo** (detalhe + movimentações inline). **0 achados:** `Nenhum registro encontrado` (`NÃO CONFIRMADO` HTTP/HTML exato) |
| (auxiliares, não necessários) | — | `/ajaxUtils.do`, `/processo/nivelSigilo.do`, `/historicoProcessosRecursos.do?actionType=listar`, `/timeout.do`, `/usuario/logon.do` | — | AJAX de UI / sessão |

`actionType` observados: `iniciar` (abrir), `pesquisar` (buscar), `listar`, `renovarSessao`, `logout`.

---

## 4. Campos do formulário `processoBuscaForm` (verbatim de `document.forms`, 2026-09-07)

`<form name="processoBuscaForm" id="buscaProcessoForm" method="post" action="/processo/consultaPublica.do;jsessionid=<JSESSIONID>?actionType=pesquisar">`

| Campo | Seletor/`name` | Tipo | Valor p/ busca por CNJ | Observação |
|---|---|---|---|---|
| Número do processo | `numeroProcesso` (id `#numeroProcesso`, size 30) | text | CNJ 20 dígitos — **campo único** (não dividido como no e-SAJ) | — |
| Tipo de pesquisa | `cbPesquisa` (id `#cbPesquisa`) | select | `NUMPROC` | opções: `NUMPROC`="Número do Processo", `NMPARTE`="Nome da parte", `NUMOAB`="OAB", `PRECATORIA`="CPF/CNPJ" |
| Número único/antigo | `flagNumeroUnico` | radio | `true` | `true`=Número Único (default), `false`=Antigo; mirror hidden `#flagNumeroUnicoHidden` |
| Comarca | `codComarca` (id `#codComarca`) | select | `-1` (Todos) | códigos numéricos de 4 dígitos: `1000`=Manaus, `2000`=Alvarães, `5600`=Manicoré, … (~60 comarcas) |
| Vara | `codVara` (id `#codVara`) / `codVaraEscolhida` (hidden) | select | vazio | populado por AJAX após escolher comarca |
| reCAPTCHA | `g-recaptcha-response` (hidden, id `#g-recaptcha-response`) | hidden | token do Google | preenchido pelo JS do reCAPTCHA |
| — | `processoPageSize` | hidden | `20` | paginação da LISTA de resultados (não das movimentações) |
| — | `processoPageNumber` | hidden | `1` | — |
| — | `processoSortColumn` | hidden | `p.numeroUnico` | — |
| — | `processoSortOrder` | hidden | `asc` | — |
| — | `opcaoConsultaPublica` (id `#opcaoConsultaPublica`) | hidden | `1` | — |
| Pesquisar | `searchButton` (id `#pesquisar`) | submit | "Pesquisar" | `onclick` zera `processoPageNumber` |
| Voltar | `backButton` (id `#backButton`) | button | — | `window.location.href='https://projudi.tjam.jus.br/projudi/'` |
| (outros modos) | `nomeParte`, `nomeAdvogado`, `oab`, `oabComplemento`, `oabUF`, `cpfCnpj`, `dadosConsulta.valorConsulta`, `loginAdvogado` | text/select | disabled quando `cbPesquisa=NUMPROC` | — |

> O corpo POST exato em bytes **não** foi capturado por HAR (o navegador foi fechado
> antes do flush). Os nomes/defaults acima vêm do DOM real do form. Um POST de form padrão
> serializa exatamente esses pares `name=value`. Confirmar o corpo literal na 8B com HAR.

---

## 5. Página do processo — cabeçalho (valores reais da amostra pública)

`<fieldset><table class="form">` dentro do `<h3>... dia(s) em tramitação</h3>`:

| Rótulo | Exemplo | Seletor | Observação |
|---|---|---|---|
| (h3) tramitação | `330 dia(s) em tramitação` | `h3` | — |
| Classe Processual | `7 - Procedimento Comum Cível` | `a.definitionClasseProcessual` | **código + label** |
| Assunto Principal | `7621 - Seguro` | `a.definitionAssuntoPrincipal` | código + label |
| Comarca | `Manaus` | — | — |
| Competência | `Vara Cível` | — | — |
| Autuação | `12/10/2025 às 03:40:12` | — | com hora |
| Distribuição | `12/10/2025 às 03:40:13` | — | com hora |
| Juízo / Juiz | `22ª ...` / `<nome>` | — | **Juiz = PII, não coletar** |
| Nível de Sigilo | `Público` | — | ≠ Público ⇒ tratar como resultado vazio (0 movimentações), **não erro** |

Aba movimentações: hidden `<input name="selectedIcon" value="tabMovimentacoesProcesso">`. A
tabela já vem no HTML inicial (mostrada/oculta por JS) — **sem request AJAX separado**.

---

## 6. Tabela de movimentações

Container: **`table.resultTable#idTableMovimentacoesmov1Grau1`**
`<colgroup>`: `30px | 50px | 1px | auto | 400px`
`<thead>`: `<th>&nbsp;</th><th>Seq.</th><th>Data</th><th>Evento</th><th>Movimentado por</th>`

Linha: `tbody > tr.even` / `tr.odd`, `id="mov1Grau<PAPEL>,,<FLAGS>,,,"` (ex.: `mov1GrauOUTROS,,SEMARQUIVO,,,`,
`mov1GrauJUIZ,,,,,`, `mov1GrauADVOGADO,,,,,`, `mov1GrauSERVIDOR,,SEMARQUIVO,,,`) — **classificador
de ator/flags, NÃO id único** (linhas repetem o mesmo `id`). **Todas as N movimentações vêm
inline, sem paginação** (69/69 na amostra).

| td | seletor | conteúdo | → `RawMovement` |
|---|---|---|---|
| 1 | `td:nth-child(1)` | `&nbsp;` se sem documento; **com** documento: `<a class="linkArquivosmovimentacoes<SEQ>"><img id="iconmovimentacoes<SEQ>" onclick="showDetail('rowmovimentacoes<SEQ>','iconmovimentacoes<SEQ>')" src="/img/themes/olive/iPlus.gif"></a>` | `raw.temDocumento` (bool) |
| 2 | `td:nth-child(2)` | inteiro (**`Seq.`**) | **`sourceMovementId` = "<seq>"** (ver §7) |
| 3 | `td:nth-child(3)` | `DD/MM/AAAA HH:MM:SS` (com segundos) | `occurredAt` (normalização na 8B; TZ America/Manaus — `NÃO CONFIRMADO` formalmente) |
| 4 | `td:nth-child(4)` | **título** = texto do `<b>` (1º filho); **complemento** = texto após o `<br>` (pode referenciar outros seqs: "Referente ao evento (seq. 53)") | `description` = título; `raw.complemento`; `raw.movementLabel` = título |
| 5 | `td:nth-child(5)` | `<img style="display:none">&nbsp;<NOME> <br> <font size="1"><b><PAPEL></b></font>` | **PII — NÃO coletar** |

Regras de texto: decodificar entidades HTML (`&nbsp;` etc.), `trim`, colapsar whitespace
(títulos vêm com runs grandes de espaço). Ignorar `<apm_do_not_touch>` (injeção AppDynamics).

Fixtures reais sanitizadas: `contracts/tjam/projudi/processo_movimentacoes.skeleton.html`,
`contracts/tjam/projudi/consulta_form.skeleton.html`, `contracts/tjam/projudi/SELECTORS.md`.

---

## 7. Identificador da movimentação — `Seq.`

O PROJUDI **fornece** um identificador estável por processo: o **`Seq.`** (inteiro),
diferente do e-SAJ (que não tinha ID). Evidências: (a) sequencial e único por processo;
(b) referenciado no texto de outros eventos ("Referente ao evento (seq. 53)"); (c) reaparece
nos ids dos elementos de documento (`iconmovimentacoes67`, `rowmovimentacoes67`,
`linkArquivosmovimentacoes67`).

```text
SourceMovementID:  recomendação → "<seq>" (string do inteiro)
Estável:           provável (sequencial append-only no processo) — NÃO CONFIRMADO entre coletas
Q5 (decisão do responsável): usar já na 8B, ou manter null até confirmar estabilidade.
```

---

## 8. Data e descrição

```text
Data:        DD/MM/AAAA HH:MM:SS (com segundos). TZ America/Manaus (NÃO CONFIRMADO formalmente;
             PROJUDI grava hora local). "Data" da coluna = do ato/andamento (não é publicação).
Descrição:   título em <b> MAIÚSCULAS + complemento após <br> (opcional; pode ter entidades HTML
             e referências a outros seqs). Sem código TPU/CNJ do movimento na tabela.
Categoria:   CategoryHint.code = nil ; CategoryHint.label = <título>. Resolução no engine
             (movement_categories); needs_review=true quando não resolver.
Normalização: NÃO nesta etapa — só o contrato de entrada.
```

---

## 9. Paginação

**Nenhuma** para movimentações — todas inline (69/69 na amostra). `processoPageSize`/
`processoPageNumber` no form são da LISTA de resultados de busca (por nome/OAB), não das
movimentações. `SourceFetchResult.Partial` não tem gatilho natural aqui; candidato:
resposta HTTP truncada / `#idTableMovimentacoesmov1Grau1` ausente sem ser sigilo.

---

## 10. Erros → códigos do `collectorengine` (proposto, validar na 8B)

| Situação | Evidência | Engine error |
|---|---|---|
| processo inexistente | `Nenhum registro encontrado` (`NÃO CONFIRMADO` HTTP/HTML exato) | `not_found` |
| segredo de justiça | `Nível de Sigilo` ≠ `Público` | **não é erro** → 0 movimentações |
| F5 WAF bloqueia (IP não-residencial) | `"Request Rejected"` / desafio `bobcmn`/`TSPD` | `unavailable` |
| reCAPTCHA exige desafio visível | `NÃO CONFIRMADO` (invisível p/ humano residencial) | `parse_error`/`unavailable` — sem código novo, sem resolver |
| HTTP 5xx | — | `unavailable` |
| timeout | — | `timeout` |
| HTML inesperado / mudança de layout | sem `#idTableMovimentacoesmov1Grau1`, sem `Nenhum registro`, sem sigilo | `parse_error` |

Só os 7 códigos existentes. Nenhuma taxonomia nova. `retriable` é decidido pelo `ClassifyError`.

---

## 11. CanHandle (não implementar — proposta baseada em evidência)

```text
- target.CourtID  → tribunal atendido por esta fonte (lista INJETADA no adapter, como no
                    DataJudAdapter; o adapter não lê o banco).
- target.CNJNumber → presente, 20 dígitos, segmento J.TR == "8.04" (Justiça Estadual do AM).
CNJ obrigatório:   SIM (busca é por número).
Q4 (decisão): escopo só busca por CNJ? (o form também tem nome/OAB/CPF-CNPJ)
Pendência:    recusar competência recursal / 2º grau? (origem "1000" = Manaus na amostra) — NÃO CONFIRMADO.
```

---

## 12. Segurança e jurídico — DP-13 / PP-12 / dúvidas Q1–Q8

### DP-13 — mecanismo técnico

**Confirmado.** Fluxo: `GET consultaPublicaNova.do` → (F5 + reCAPTCHA invisível) → `POST
consultaPublica.do?actionType=pesquisar` → página do processo com `#idTableMovimentacoesmov1Grau1`
inline. Cabe num worker Go com HTTP client + parser HTML — **mas** o F5 bloqueia acesso
automatizado/datacenter (ver Q2).

### PP-12 — aval jurídico

```text
STATUS: PENDENTE — BLOQUEADOR da Etapa 8B.
Nenhum registro no repositório de aval jurídico/negocial para automatizar a coleta no TJAM.
DECISOES-FASE-2.1 §PP-12: "antes da Fase 12". A Etapa 8B NÃO deve começar sem PP-12 resolvido.
```

### Dúvidas que precisam de decisão do responsável

| # | Dúvida | Alternativas |
|---|---|---|
| Q1 | Acesso automatizado é bloqueado pelo F5 (só navegador humano residencial passa). Como a coleta de produção vai rodar? | (a) proxy residencial contratado; (b) IP fixo autorizado pelo TJAM / acordo institucional; (c) navegador headed real num runner dedicado; (d) reconsiderar |
| Q2 | Um adapter em IP de nuvem provavelmente será bloqueado pelo F5. Aceitável? | precisa de decisão de produto/infra antes da 8B |
| Q3 | `source_kind` = `projudi_tjam` (já em `KnownSourceKind` e `tracking-labels.ts`)? | recomendo `projudi_tjam` — **aguardando aprovação** |
| Q4 | Escopo só busca por CNJ? | recomendo sim |
| Q5 | `sourceMovementId` = `Seq.`, ou `null` até confirmar estabilidade entre coletas? | precisa de decisão |
| Q6 | Ignorar "Movimentado por" e a aba "Partes" (PII)? | recomendo ignorar ambas |
| Q7 | O PROJUDI autenticado é opção de fonte? Credenciais de quem? (DP-13) | decisão sua |
| Q8 | reCAPTCHA: hoje é invisível p/ humano residencial. Se virar desafio visível, a coleta automatizada fica inviável — plano B? | decisão sua |

---

## 13. Pontos ainda `NÃO CONFIRMADO`

1. Corpo POST literal em bytes (nomes/defaults confirmados via DOM; falta HAR).
2. HTTP/HTML exatos de "processo não encontrado" (buscamos um processo existente).
3. Se `search.do`/`consultaPublica.do` exige o JSESSIONID do GET inicial.
4. TZ e semântica exata da coluna "Data".
5. Estabilidade do `Seq.` entre coletas.
6. Comportamento sob rate limit / bloqueio por IP (não provocado).
7. Conteúdo de `robots.txt` / Termos de Uso (o host retorna o desafio do WAF).
8. Se o adapter deve recusar 2º grau / competência recursal.
9. Se o reCAPTCHA pode escalar para desafio visível.
10. **PP-12** (aval jurídico) — PENDENTE.

---

## 14. Fontes

- **Sessão de navegador real (Edge via Playwright canal msedge)** conduzida pelo responsável,
  2026-09-07 — HTML real do form + `document.forms` + HTML real da página do processo com
  movimentações. Capturas em `scratchpad/pw/out2/` (não versionadas; PII).
- Screenshots reais do responsável (form + aba Movimentações do processo `0280181-52.2025.8.04.1000`).
- `Carcalto/TJAM-PROJUDI-Consulta` (GitHub, Python/Selenium, 2025-07) — fluxo **autenticado**.
- `projudi.tjpr.jus.br/.../consultaPublica.do` — instalação-irmã (form via JS).
- Repo: `packages/collectors-core/src/source.ts`, `packages/adapter-datajud/src/*`,
  `supabase/seed.sql`, `docs/PLANO-FASE-1.md`, `docs/DECISOES-FASE-2.1.md`,
  `docs/ACOMPANHAMENTO-ANALISE.md`.

---

## 15. Próximo passo

```text
Etapa 8A CONCLUÍDA — contrato do PROJUDI Consulta Pública confirmado.

Etapa 8B (implementação do adapter projudi_tjam) fica CONDICIONADA a:
  - PP-12 resolvido (aval jurídico); e
  - decisão sobre Q1/Q2 (como contornar o bloqueio F5 para acesso não-residencial).

Com isso, a 8B implementa ProcessDataSource em Go (Kind/CanHandle/Fetch) contra ESTE
documento + contracts/tjam/projudi/, seguindo o padrão do DataJudAdapter, sem reinventar
o comportamento da fonte.
```
