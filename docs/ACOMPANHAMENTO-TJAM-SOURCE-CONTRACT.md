# JuriFlow · Acompanhamento-H · Etapa 8A (1ª iteração) — Contrato da fonte e-SAJ CPOPG do TJAM

> **Status:** investigação concluída. **SUPERSEDIDO** pela decisão do responsável de usar o
> **PROJUDI** como fonte (ver `docs/ACOMPANHAMENTO-TJAM-PROJUDI-SOURCE-CONTRACT.md`).
> Mantido como registro histórico e porque a migração e-SAJ→PROJUDI é relevante para o design.
>
> **Data das evidências:** 2026-09-06. **Método:** requisições GET públicas manuais (curl) a
> `consultasaj.tjam.jus.br`; scraper de referência `courtsbr/esaj` (R). Nada inventado.
>
> **Motivo do supersedimento:** o responsável informou que o acesso ao e-SAJ que o projeto
> precisa **não está disponível** para ele, e que a fonte pretendida é o PROJUDI Consulta
> Pública. Além disso, a investigação achou que **o TJAM migra processos do e-SAJ para o
> PROJUDI** — para um processo migrado, o e-SAJ congela na data da transferência.

---

## 0. Sumário

| | |
|---|---|
| Fonte | e-SAJ CPOPG (Consulta de Processos do 1º Grau) — Softplan SAJ |
| Base URL | `https://consultasaj.tjam.jus.br` |
| Mecanismo | HTTP + HTML server-side, **UTF-8**, sem JS obrigatório, sem login, **sem CAPTCHA** para busca por nº de processo |
| Sessão | cookie `JSESSIONID` (Path=`/cpopg`) do `open.do`; **não** obrigatório para `show.do` |
| Incremental (`since`) | **não suportado** — `show.do` devolve o histórico completo inline, sempre |
| Paginação de movimentações | **nenhuma** (323 movimentações inline num teste) |
| ID de movimentação | a fonte **não fornece** ID estável por movimentação; só `cdDocumento` para movimentações com documento (~1/3) → `source_movement_id = null` |
| Achado crítico | processos migram e-SAJ→PROJUDI ("Processo transferido para o PROJUDI") |

---

## 1. Fluxo HTTP

```text
1. (opcional) GET https://consultasaj.tjam.jus.br/cpopg/open.do   → 200, Set-Cookie JSESSIONID; Path=/cpopg
2. GET /cpopg/search.do
     conversationId=
     cbPesquisa=NUMPROC
     dadosConsulta.localPesquisa.cdLocal=-1
     dadosConsulta.tipoNuProcesso=UNIFICADO
     numeroDigitoAnoUnificado=<NNNNNNN-DD.AAAA>   (ou os 13 primeiros dígitos do CNJ)
     foroNumeroUnificado=<OOOO>                    (4 dígitos finais do CNJ)
     dadosConsulta.valorConsultaNuUnificado=<CNJ 20 dígitos>
     dadosConsulta.valorConsulta=
     uuidCaptcha=  vlCaptcha=  novoVlCaptcha=
   → 1 achado:  HTTP 302  Location: /cpopg/show.do?processo.codigo=<COD>&processo.foro=<N>&processo.numero=<CNJ>
   → 0 achados: HTTP 200  com  <td id="mensagemRetorno"> "Não existem informações disponíveis para os parâmetros informados."
3. GET /cpopg/show.do?processo.codigo=<COD>&processo.foro=<N>
   → HTML completo com o processo e as movimentações inline
```

Endpoints vistos: `/cpopg/open.do`, `/cpopg/search.do`, `/cpopg/show.do`,
`/cpopg/abrirDocumentoVinculadoMovimentacao.do`, `/cpopg/manterSessao.do`,
`/cpopg/imagemCaptcha.do` (existe mas não é acionado no fluxo NUMPROC).

**Encoding:** `Content-Type: text/html;charset=UTF-8`; corpo confirmado UTF-8.
Descrições usam entidades HTML (`&atilde;`, `&ccedil;`, `&ocirc;`) — decodificar entidades.

---

## 2. Formulário `consultarProcessoForm` (id `formConsulta`), method GET, action `/cpopg/search.do`

| Campo | `name` | Papel |
|---|---|---|
| tipo de busca | `cbPesquisa` — `NUMPROC` / `NMPARTE` / `DOCPARTE` / `NMADVOGADO` / `NUMOAB` / `PRECATORIA` / `DOCDELEG` / `NUMCDA` | usar `NUMPROC` |
| padrão do nº | `dadosConsulta.tipoNuProcesso` (radio) — `UNIFICADO` / `SAJ` | usar `UNIFICADO` |
| nº (7+2 díg + ano) | `numeroDigitoAnoUnificado` | `NNNNNNN-DD.AAAA` |
| foro (4 díg origem) | `foroNumeroUnificado` | `OOOO` |
| CNJ completo | `dadosConsulta.valorConsultaNuUnificado` (hidden) | 20 dígitos |
| foro combo | `cdForo` (`comboForo`), default `-1` | `-1` = todos |
| conversa | `conversationId` (hidden, vazio) | — |

Segmento CNJ do TJAM: `J.TR` = `8.04` (J=8 Justiça Estadual, TR=`04`).

---

## 3. Movimentações — `show.do`

`<tbody id="tabelaTodasMovimentacoes" style="display:none;">` (lista completa, inline; a
`<tbody id="tabelaUltimasMovimentacoes">` é a visível, só as últimas). Mesma `<table>`.

Linha: `<tr class="fundoClaro|fundoEscuro containerMovimentacao">`, 3 `<td>`:
1. `td.dataMovimentacao` → `DD/MM/AAAA` (**sem hora**)
2. `td[aria-hidden]` (width 20) → opcional `a.linkMovVincProc#linkMovVincProc-<cdDocumento>` (ícone `doc.png`), só quando há documento anexo
3. `td.descricaoMovimentacao` → **título** (texto direto **ou** dentro de `a.linkMovVincProc#linkMovVincProc-2-<cdDoc>`) + `<br/>` + `span[style*="font-style: italic"]` = **complemento** (pode ser só espaço; com entidades)

Cabeçalho do processo (elementos com `id`): `numeroProcesso`, `classeProcesso`,
`assuntoProcesso`, `areaProcesso` (texto do `<span title>`), `foroProcesso`, `varaProcesso`,
`juizProcesso`, `dataHoraDistribuicaoProcesso` (tem hora), `valorAcaoProcesso`.
Segredo de justiça: `div#popupSenhaProcesso` presente ⇒ movimentações não exibidas.

---

## 4. `RawMovement` (a mapear na implementação — aqui só o contrato de entrada)

| campo | origem e-SAJ | nota |
|---|---|---|
| `sourceMovementId` | **`null` sempre** | e-SAJ não dá ID de movimentação; `cdDocumento` é do documento e parcial |
| `occurredAt` | `td.dataMovimentacao` → `DD/MM/AAAA` | data pura (sem hora); TZ America/Manaus |
| `description` | título de `td.descricaoMovimentacao` (texto ou `<a>`) | decode de entidades, trim, colapsar espaços |
| `raw` | `{ data, titulo, complemento, cdDocumento?, trClass }` | **sem** dados de partes |
| hint categoria | `raw.movementLabel` = título; `raw.movementCode` = ausente (e-SAJ não expõe código TPU/CNJ) | resolução no engine |

---

## 5. Erros → `collectorengine` (proposto)

| Situação | Evidência | Código |
|---|---|---|
| processo inexistente | HTTP **200** + `#mensagemRetorno` "Não existem informações disponíveis" | `not_found` (**não** é 404) |
| indisponibilidade | HTTP 5xx (503 visto no `cposg`) | `unavailable` |
| timeout | sem resposta | `timeout` |
| HTML sem `#tabelaTodasMovimentacoes` e sem `#mensagemRetorno` e sem `#popupSenhaProcesso` | — | `parse_error` |
| segredo de justiça | `#popupSenhaProcesso` | **não é erro** → 0 movimentações |
| CAPTCHA reaparece | `#captchaCodigo` / `imagemCaptcha` no corpo | `parse_error`/`unavailable` — sem código novo, sem resolver |

---

## 6. `source_kind`

Recomendação (histórica): `tjam_esaj` (a fonte é o e-SAJ, distinta do PROJUDI). Como o
projeto pivotou para o PROJUDI (`projudi_tjam`), esta recomendação fica em espera.

---

## 7. Lacunas `NÃO CONFIRMADO`

Se `search.do` exige o cookie do `open.do`; se a "Data" é do ato ou do lançamento; limite de
tamanho de resposta em processos gigantes; comportamento de rate limit; `robots.txt`/ToS;
se deve recusar 2º grau; estado do `cposg` (503 na coleta). **PP-12** (aval jurídico) — PENDENTE.

---

## 8. Fontes

- Requisições GET públicas manuais a `consultasaj.tjam.jus.br/cpopg/{open,search,show}.do`, 2026-09-06.
- `courtsbr/esaj` (GitHub, R) — `R/cpopg.R`, `R/aux_cpoxg.R`, `R/aux_captcha.R`, `R/parse_cpopg.R`; lista TJAM como implementado; seletor `#tabelaTodasMovimentacoes`.
- Repo: `packages/collectors-core/src/source.ts`, `packages/adapter-datajud/src/*`, `supabase/seed.sql`.

Fixtures: `contracts/tjam/README.md`, `contracts/tjam/SELECTORS.md`,
`contracts/tjam/cpopg_search_nao_encontrado.fragment.html`,
`contracts/tjam/cpopg_show_movimentacoes.skeleton.html`.
