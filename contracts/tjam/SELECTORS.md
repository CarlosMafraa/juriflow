# e-SAJ CPOPG (TJAM) — seletores para o parser (SUPERSEDIDO pelo PROJUDI)

Ver `contracts/tjam/projudi/SELECTORS.md` para a fonte atual. Contrato e-SAJ:
`docs/ACOMPANHAMENTO-TJAM-SOURCE-CONTRACT.md`.

## Fluxo
| Passo | Método | URL |
|---|---|---|
| abrir sessão (opcional) | GET | `/cpopg/open.do` → Set-Cookie `JSESSIONID; Path=/cpopg` |
| buscar por nº | GET | `/cpopg/search.do` — 1 achado → **302** para `show.do`; 0 achados → **200** com `#mensagemRetorno` |
| página do processo | GET | `/cpopg/show.do?processo.codigo=<COD>&processo.foro=<N>` |

### Query de `search.do` (cbPesquisa=NUMPROC)
```
conversationId=
cbPesquisa=NUMPROC
dadosConsulta.localPesquisa.cdLocal=-1
dadosConsulta.tipoNuProcesso=UNIFICADO
numeroDigitoAnoUnificado=<NNNNNNN-DD.AAAA>
foroNumeroUnificado=<OOOO>
dadosConsulta.valorConsultaNuUnificado=<CNJ 20 dígitos>
dadosConsulta.valorConsulta=  uuidCaptcha=  vlCaptcha=  novoVlCaptcha=
```

## Detecção de resultado
| Situação | Como detectar | Código |
|---|---|---|
| encontrado | resposta tem `tbody#tabelaTodasMovimentacoes` | — |
| inexistente | HTTP 200 **e** `#mensagemRetorno` contém "Não existem informações disponíveis" | `not_found` |
| segredo de justiça | `div#popupSenhaProcesso` | não é erro → 0 movimentações |
| indisponível | HTTP 5xx | `unavailable` |
| HTML inesperado | 200 sem `#tabelaTodasMovimentacoes` e sem `#mensagemRetorno` e sem `#popupSenhaProcesso` | `parse_error` |

## Movimentações
Container: `tbody#tabelaTodasMovimentacoes` (oculto; lista completa, sem paginação).
Linha: `tr.containerMovimentacao` (`fundoClaro`/`fundoEscuro`). 3 `<td>`:
| td | seletor | extrair |
|---|---|---|
| 1 | `td.dataMovimentacao` | `DD/MM/AAAA` (sem hora; TZ America/Manaus) → `occurredAt` |
| 2 | `td[aria-hidden]` | opcional `a.linkMovVincProc#linkMovVincProc-<cdDocumento>` → `raw.cdDocumento` (não usar como `sourceMovementId`) |
| 3 | `td.descricaoMovimentacao` | título (texto ou `a.linkMovVincProc#linkMovVincProc-2-<cdDoc>`); `<br>`; `span[style*="font-style: italic"]` = complemento |

`source_movement_id = null` sempre (e-SAJ não dá ID de movimentação).
Categoria: só o título; `CategoryHint.code = nil`, `.label = <título>`.
