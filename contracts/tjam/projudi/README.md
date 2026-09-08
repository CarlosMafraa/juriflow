# contracts/tjam/projudi — fixtures da fonte PROJUDI Consulta Pública TJAM

**Status: contrato CONFIRMADO** (sessão de navegador real 2026-09-07). Ver
[`docs/ACOMPANHAMENTO-TJAM-PROJUDI-SOURCE-CONTRACT.md`](../../../docs/ACOMPANHAMENTO-TJAM-PROJUDI-SOURCE-CONTRACT.md).

## Arquivos

| Arquivo | Origem | Sanitização |
|---|---|---|
| `consulta_form.skeleton.html` | dump de `document.forms` + HTML de `GET /processo/consultaPublicaNova.do?actionType=iniciar`, via Edge que passou o F5 WAF em 2026-09-07 | nenhuma necessária (form vazio); `jsessionid` do `action` → `<JSESSIONID>` |
| `processo_movimentacoes.skeleton.html` | HTML real de `POST /processo/consultaPublica.do?actionType=pesquisar` (processo público "Nível de Sigilo: Público", 69 movimentações) | **nomes de pessoas/empresas → sintéticos**; 6 das 69 linhas; estrutura idêntica |
| `SELECTORS.md` | derivado do HTML real | — |

## Encoding

A página declara `<meta charset="ISO-8859-1">` mas os **bytes são UTF-8**
(`EXPEDIÇÃO` = `c3 87 c3 83`). O parser deve **decodificar como UTF-8** e ignorar o
charset declarado.

## Por que o HTML real completo não está aqui

A resposta real (~100 KB) inclui a aba "Partes" e a coluna "Movimentado por" com nomes de
pessoas, advogados e juízes — PII desnecessária ao contrato do parser de movimentações.
O esqueleto preserva o que o parser precisa: `table.resultTable#idTableMovimentacoesmov1Grau1`,
as 5 colunas, as duas variações de linha (com/sem documento anexo), o `Seq.` como
identificador, o formato de data com hora, e o título em `<b>` + complemento após `<br>`.

## Acesso automatizado é bloqueado pelo F5

`projudi-consulta.tjam.jus.br` está atrás de F5 BIG-IP Advanced WAF. curl e navegador
**headless** recebem desafio JS ou `"Request Rejected"`. Só um **navegador real (headed) em
IP residencial** passa. Isso é um risco de produção — ver Q1/Q2 no contrato. Um HAR completo
do POST de busca (corpo em bytes) ainda precisa ser capturado numa próxima sessão (o
navegador foi fechado antes do flush do HAR nesta).

## Nada aqui é código de produção

Nenhum adapter/cliente/parser foi implementado (Etapa 8A é só investigação). A implementação
(8B) fica condicionada a **PP-12** (aval jurídico).
