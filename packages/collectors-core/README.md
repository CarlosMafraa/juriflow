# @juriflow/collectors-core

**Arquitetura de fontes de acompanhamento processual — apenas os contratos.**

Este pacote define a _porta_ (`ProcessDataSource`) e o `SourceRegistry` que
permitem plugar múltiplas estratégias de coleta **sem tocar no núcleo** do
JuriFlow (normalizador, detector de mudanças, motor de regras, notificações).

> **Fase 2 (Fundação):** este pacote contém **somente contratos e o registry**.
> Nenhum coletor concreto é implementado aqui nesta fase.

## O que entra depois (Fase de Acompanhamento)

```
ProcessDataSource            (porta — definida aqui)
        │
        ├── DataJudAdapter        (API oficial do CNJ; referência estrutural + consulta)
        ├── TribunalApiAdapter    (APIs próprias de tribunais, quando existirem)
        ├── TjamProjudiAdapter    (consulta pública Projudi / TJAM)
        └── ScraperAdapter        (coletores específicos por tribunal, sob demanda)
```

Cada tribunal declara qual `SourceKind` usar. Trocar a estratégia de um tribunal
(ex.: migrar o TJAM de scraper para uma API melhor) é adicionar/registrar um
adapter — o resto do sistema não muda. Ver ADR-0004.

## Regras de design

- O núcleo depende **apenas** de `ProcessDataSource`, `RawMovement` e `SourceRegistry`.
- Nenhum código fora de um adapter pode conhecer "TJAM", "DataJud" etc.
- `RawMovement` carrega o payload bruto (`raw`) + campos mínimos; a normalização
  para a Movimentação Canônica do JuriFlow é responsabilidade de outro pacote
  (`@juriflow/movement-normalizer`, fase futura).
