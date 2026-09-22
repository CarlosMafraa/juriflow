# ADR-0007 — MVP de acompanhamento: só TJAM/Projudi, sem DataJud, worker em VPS

**Status:** Aceito · **Data:** 2026-09-22

## Contexto

O roadmap original (`docs/PLANO-FASE-1.md`, seção 15) previa DataJud como
referência estrutural + fonte de consulta, com Projudi/TJAM como fonte mais
atual para tribunais específicos, ambos entrando na "Fase de Acompanhamento"
(F7-F12). Há pressão comercial para entregar valor ao primeiro cliente o mais
rápido possível; o cliente só precisa do TJAM.

## Decisão

Para o MVP:

1. **Só TJAM/Projudi.** DataJud fica fora — não é implementado nesta fase
   (decisão de produto, não técnica: "não é viável" para o caso de uso atual).
2. **Scraping com Playwright**, não HTTP puro. A consulta pública do
   Projudi/TJAM fica atrás de uma proteção anti-bot (F5/Distil, cookies `TS*`,
   script `TSPD`) que só resolve executando JavaScript real — confirmado via
   `curl` (recebe página de desafio) vs. navegação manual normal (funciona).
3. **Worker Node separado** (`services/scraper-worker`), fora do Supabase:
   Edge Functions (Deno) não suportam Chromium/Playwright.
4. **1 VPS com Docker Compose** roda o worker + WAHA. Volume inicial baixo
   (~200 processos/dia, até 10 clientes) não justifica infra mais elaborada
   (fila distribuída, múltiplos workers, proxy residencial).
5. **Supabase Cloud**, não o stack local — as migrations já existentes sobem
   via `supabase db push`; nenhum retrabalho de schema.
6. **Notificação simplificada**: 1 template geral (não configurável por
   status/destinatário ainda), sem fila com retry sofisticado — falha é
   logada e a próxima rotina diária tenta de novo.

Ver `packages/collectors-core` (ADR-0004) — a porta `ProcessDataSource` já
suportava múltiplas fontes; esta decisão apenas define QUAL adapter é
implementado primeiro e onde ele roda.

## Consequências

- `courts.tracking_source_kind` (migration 0017) torna o "qual tribunal usa
  qual fonte" um dado, não código — adicionar um 2º tribunal depois é uma
  linha de seed + um novo adapter, sem tocar no pipeline.
- Os seletores DOM em `tjam-projudi.selectors.ts` não foram confirmados contra
  o HTML real (bloqueado para requisição sem browser) — precisam de validação
  manual (`npm run inspect`) antes de produção.
- Motor de regras configurável, templates por evento, fila com retry e
  dashboard completo ficam para depois do MVP (fases 10, 13, 14 do roadmap
  original) — o que existe agora é o suficiente para o fluxo ponta a ponta
  funcionar com 1 template e 1 tentativa por dia.
