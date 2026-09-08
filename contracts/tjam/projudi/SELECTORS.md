# PROJUDI Consulta Pública TJAM — seletores e contrato para o adapter (Etapa 8B)

Verificado em 2026-09-07 por sessão de navegador real (Edge) que passou o F5 WAF.
Documento completo: [`docs/ACOMPANHAMENTO-TJAM-PROJUDI-SOURCE-CONTRACT.md`](../../../docs/ACOMPANHAMENTO-TJAM-PROJUDI-SOURCE-CONTRACT.md).
Fixtures nesta pasta.

## Encoding

A página declara `<meta charset="ISO-8859-1">` mas os **bytes são UTF-8**
(`EXPEDIÇÃO` = `c3 87 c3 83`). **Decodificar como UTF-8**, ignorar o charset declarado.

## Fluxo HTTP

| Passo | Método | URL | Notas |
|---|---|---|---|
| abrir formulário | GET | `/processo/consultaPublicaNova.do?actionType=iniciar` | passa pelo F5 WAF (desafio JS silencioso p/ navegador real) + estabelece `JSESSIONID`; reCAPTCHA **invisível** carrega |
| buscar | **POST** | `/processo/consultaPublica.do;jsessionid=<JSESSIONID>?actionType=pesquisar` | corpo = campos do form `processoBuscaForm` (ver abaixo) |
| resultado (1 processo) | — | (mesma URL, HTTP 200) | **renderiza a página do processo direto** (não há 302; não há request separado p/ o detalhe) |
| resultado (0 processos) | — | `NÃO CONFIRMADO` (não capturado) | mensagem `Nenhum registro encontrado` (screenshot + scraper `Carcalto`) |

Auxiliares vistos na página (não necessários p/ listar movimentações):
`/ajaxUtils.do`, `/processo/nivelSigilo.do`, `/historicoProcessosRecursos.do?actionType=listar`,
`/timeout.do`, `/usuario/logon.do` (`actionType` = `renovarSessao`/`logout`).

## Corpo do POST de busca (form `processoBuscaForm`)

| campo | valor (busca por CNJ) | origem |
|---|---|---|
| `numeroProcesso` | CNJ (20 dígitos; **campo único**, não dividido) | text `#numeroProcesso` |
| `cbPesquisa` | `NUMPROC` | select (`NMPARTE`/`NUMOAB`/`PRECATORIA` = outros modos) |
| `flagNumeroUnico` | `true` | radio (`false` = número antigo) |
| `codComarca` | `-1` (Todos) ou código de 4 díg. (`1000`=Manaus…) | select |
| `codVara` / `codVaraEscolhida` | vazio | selects |
| `g-recaptcha-response` | token do reCAPTCHA (preenchido pelo JS do Google) | hidden |
| `processoPageSize` | `20` | hidden |
| `processoPageNumber` | `1` | hidden |
| `processoSortColumn` | `p.numeroUnico` | hidden |
| `processoSortOrder` | `asc` | hidden |
| `opcaoConsultaPublica` | `1` | hidden |
| `searchButton` | `Pesquisar` | submit |

> O corpo exato em bytes **não** foi capturado por HAR (o navegador foi fechado
> abruptamente antes do flush). Os **nomes e defaults** acima vêm do DOM real do
> form (`document.forms` + HTML). Um POST de form padrão serializa exatamente esses
> pares `name=value`. Confirmar o corpo literal na 8B com um HAR.

## Cabeçalho do processo (página de detalhe, `<fieldset><table class="form">`)

Rótulos reais (valores da amostra pública):

| Rótulo | Exemplo | Observação |
|---|---|---|
| (h3) `... dia(s) em tramitação` | `330 dia(s) em tramitação` | — |
| `Classe Processual:` | `7 - Procedimento Comum Cível` | `<a class="definitionClasseProcessual">` — **código + label** |
| `Assunto Principal:` | `7621 - Seguro` | `<a class="definitionAssuntoPrincipal">` — código + label |
| `Comarca:` | `Manaus` | — |
| `Competência:` | `Vara Cível` | — |
| `Autuação:` | `12/10/2025 às 03:40:12` | com hora |
| `Distribuição:` | `12/10/2025 às 03:40:13` | com hora |
| `Juízo:` / `Juiz:` | `22ª ...` / `<nome>` | **Juiz = PII** |
| `Nível de Sigilo:` | `Público` | quando ≠ Público ⇒ tratar como resultado vazio (0 movimentações), não erro |

Aba movimentações: hidden `<input name="selectedIcon" value="tabMovimentacoesProcesso">`.
A tabela `#idTableMovimentacoesmov1Grau1` **já vem no HTML inicial do detalhe** (mostrada/oculta
por JS) — **não** há request AJAX separado para as movimentações.

## Tabela de movimentações

Container: **`table.resultTable#idTableMovimentacoesmov1Grau1`**
Cabeçalho: `<thead><tr><th>&nbsp;</th><th>Seq.</th><th>Data</th><th>Evento</th><th>Movimentado por</th></tr></thead>`
`<colgroup>`: `30px | 50px | 1px | auto | 400px`

Linha: `tbody > tr.even|tr.odd`, `id="mov1Grau<PAPEL>,,<FLAGS>,,,"` (ex.: `mov1GrauOUTROS,,SEMARQUIVO,,,`,
`mov1GrauJUIZ,,,,,`, `mov1GrauADVOGADO,,,,,`) — **classificador de ator/flags, NÃO um id único**
(várias linhas repetem o mesmo `id`). **Todas as N movimentações vêm inline; sem paginação**
(69/69 na amostra).

| td | seletor | extrair | vira, em `RawMovement` |
|---|---|---|---|
| 0 | `td:nth-child(1)` | `&nbsp;` se sem documento; **com** documento: `a.linkArquivosmovimentacoes<SEQ>` + `img#iconmovimentacoes<SEQ>` com `onclick="showDetail('rowmovimentacoes<SEQ>', 'iconmovimentacoes<SEQ>')"` | `raw.temDocumento` (bool) |
| 1 | `td:nth-child(2)` | inteiro (**Seq.**) | **`sourceMovementId` = o Seq** (ver nota) |
| 2 | `td:nth-child(3)` | `DD/MM/AAAA HH:MM:SS` (com segundos) | `occurredAt` (normalização na 8B; TZ America/Manaus — `NÃO CONFIRMADO` formalmente) |
| 3 | `td:nth-child(4)` | **título** = texto do `<b>` (1º filho); **complemento** = texto após o `<br>` | `description` = título; `raw.complemento` = complemento; `raw.movementLabel` = título |
| 4 | `td:nth-child(5)` | nome + `<font size="1"><b>papel</b></font>` | **PII — NÃO coletar** |

Regras de texto: decodificar entidades HTML (`&nbsp;` etc.), `trim`, colapsar whitespace
(os títulos vêm com runs grandes de espaços). Ignorar `<apm_do_not_touch>` (injeção AppDynamics).

## Identificador da movimentação — `Seq.`

O PROJUDI **fornece** um identificador estável por processo: o **`Seq.`** (inteiro).
Evidências: (a) é sequencial e único por processo; (b) outros eventos o referenciam no
texto ("Referente ao evento (seq. 53)"); (c) reaparece nos ids dos elementos de documento
(`iconmovimentacoes67`, `rowmovimentacoes67`, `linkArquivosmovimentacoes67`).
⇒ **`sourceMovementId = "<seq>"`** é viável (mais robusto que hash puro). **Decisão pendente
(Q5):** usar já na 8B, ou manter `null` até confirmar que o `Seq.` de uma movimentação não
muda entre coletas.

## Categoria

PROJUDI **não** expõe código TPU/CNJ do movimento na tabela — só o texto do título em `<b>`.
⇒ `CategoryHint.code = nil`, `CategoryHint.label = <título>`. Resolução no engine;
`needs_review=true` quando não resolver.

## Erros → `collectorengine` (proposto)

| Situação | Evidência | Engine error |
|---|---|---|
| processo inexistente | `Nenhum registro encontrado` (`NÃO CONFIRMADO` HTTP/HTML exato) | `not_found` |
| segredo de justiça | `Nível de Sigilo` ≠ `Público` | **não é erro** → 0 movimentações |
| F5 WAF bloqueia (IP não-residencial) | `"Request Rejected"` / desafio `bobcmn`/`TSPD` | `unavailable` |
| reCAPTCHA exige desafio visível | `NÃO CONFIRMADO` (invisível p/ humano residencial) | `parse_error`/`unavailable` — sem código novo, sem resolver |
| 5xx | — | `unavailable` |
| timeout | — | `timeout` |
| HTML inesperado / mudança de layout | sem `#idTableMovimentacoesmov1Grau1` e sem `Nenhum registro` e sem sigilo | `parse_error` |

Só os 7 códigos existentes. Nenhuma taxonomia nova.
