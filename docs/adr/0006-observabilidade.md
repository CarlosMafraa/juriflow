# ADR-0006 — Observabilidade básica

**Status:** Aceito · **Data:** 2026-09-02 · **Fase:** 2

## Contexto

Brief §13: estratégia consistente de logs, tratamento de erros, identificação de
requisições, sem expor informações sensíveis.

## Decisão

- **Request ID:** cabeçalho `x-request-id` (configurável). O frontend gera um id
  por requisição (interceptor) e o inclui; fases futuras propagam nos jobs/Edge
  Functions e gravam em `audit_logs.context`.
- **Logger estruturado** (`core/observability/logger.ts`): saída JSON com
  `level`, `msg`, `requestId`, `context`. Nível vem de `LOG_LEVEL`.
- **Redação:** o logger nunca serializa `password`, `token`, `apikey`,
  `authorization`, `access_token`, `refresh_token`, `secret` — chaves com esses
  nomes viram `[REDACTED]`.
- **Erros:** `error.interceptor.ts` normaliza falhas HTTP, registra com o request
  id e dispara um toast amigável; erros de autenticação (401/403) não vazam
  detalhes.
- Sem provedor externo de APM nesta fase (fica para a fase de hardening).

## Consequências

- Toda requisição é rastreável ponta a ponta pelo request id.
- Padrão único de log evita `console.log` solto (bloqueado pelo lint).
