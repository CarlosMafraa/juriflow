# ADR-0004 — Arquitetura de fontes de acompanhamento (multi-adapter)

**Status:** Aceito · **Data:** 2026-09-02 · **Fase:** 2 (só contratos)

## Contexto

O acompanhamento processual usa **mecanismos com papéis diferentes**:

- **DataJud (API CNJ)** — referência estrutural (tribunais, categorias, aliases)
  e fonte de consulta; movimentações podem estar defasadas.
- **Consulta pública do tribunal / Projudi (ex.: TJAM)** — fonte mais atual para
  certos tribunais; a documentação prevê estudar a consulta pública do Projudi.
- **Scraping / coletores específicos por tribunal** — quando não há API adequada.

O sistema **não** deve ser desenhado como "DataJud + scraping" (duas opções
fixas). Deve permitir adicionar uma 4ª, 5ª, 10ª fonte sem tocar no núcleo
(normalizador, detector de mudanças, motor de regras, notificações).

## Decisão

Porta única `ProcessDataSource` + `SourceRegistry` em
`packages/collectors-core` (só contratos nesta fase):

```
ProcessDataSource            (porta)
        ├── DataJudAdapter        (fase de acompanhamento)
        ├── TribunalApiAdapter    (fase de acompanhamento)
        ├── TjamProjudiAdapter    (fase de acompanhamento)
        └── ScraperAdapter        (fase de acompanhamento)
```

- Cada tribunal declara qual `SourceKind` usar.
- `SourceKind` é um union **aberto** — novas fontes se registram com qualquer
  identificador, sem editar o core.
- O núcleo resolve fontes **apenas** via `SourceRegistry`; proibido
  `if (kind === 'tjam')` fora de um adapter.
- `RawMovement.raw` preserva o payload original; a normalização para a
  Movimentação Canônica é de outro pacote (`@juriflow/movement-normalizer`,
  fase futura).

## Fase 2

**Nenhum coletor concreto.** Apenas `source.ts` (contratos), `registry.ts`,
`errors.ts` e testes do registry. DataJud, Projudi/TJAM e scraping ficam para a
Fase de Acompanhamento.

## Consequências

- Trocar a estratégia de um tribunal (ex.: Projudi → API melhor do TJAM) é
  adicionar/registrar um adapter.
- Falha de uma fonte fica contida no adapter; o restante do pipeline segue.
