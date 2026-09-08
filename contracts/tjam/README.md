# contracts/tjam — fixtures do contrato e-SAJ CPOPG do TJAM (SUPERSEDIDO)

O projeto pivotou para o **PROJUDI** como fonte — ver `contracts/tjam/projudi/` e
`docs/ACOMPANHAMENTO-TJAM-PROJUDI-SOURCE-CONTRACT.md`. Estes arquivos são o registro da
1ª iteração da Etapa 8A (e-SAJ). Contrato: `docs/ACOMPANHAMENTO-TJAM-SOURCE-CONTRACT.md`.

| Arquivo | Origem | Sanitização |
|---|---|---|
| `cpopg_search_nao_encontrado.fragment.html` | fragmento real de `GET /cpopg/search.do` com CNJ inexistente (2026-09-06) | nenhuma (só a caixa de mensagem, sem PII) |
| `cpopg_show_movimentacoes.skeleton.html` | esqueleto reconstruído da estrutura de `#tabelaTodasMovimentacoes` (valores sintéticos) | todos os valores sintéticos |
| `SELECTORS.md` | seletor→campo do parser e-SAJ | — |

Encoding real do e-SAJ: **UTF-8** (`Content-Type: text/html;charset=UTF-8`), com entidades HTML.
