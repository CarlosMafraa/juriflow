# @juriflow/scraper-worker

Serviço Node standalone (roda numa VPS, fora do Supabase) responsável pelo
pipeline de acompanhamento do MVP: coleta no Projudi/TJAM → histórico →
detecção de mudança → notificação WhatsApp (WAHA). Ver plano do MVP e ADR-0004.

## Por que um serviço separado (não Edge Function)?

O scraping usa Playwright (Chromium real) porque a consulta pública do
Projudi/TJAM fica atrás de uma proteção anti-bot que exige JavaScript — algo
que Supabase Edge Functions (Deno, sem browser) não suporta.

## Arquitetura (SOLID)

```
src/
├─ ports/          # interfaces que o núcleo depende (Dependency Inversion)
├─ domain/         # funções puras — hashing, template de mensagem (sem I/O)
├─ usecases/       # TrackProcessUseCase — orquestra o pipeline via ports
├─ adapters/       # TjamProjudiAdapter — implementa ProcessDataSource (collectors-core)
├─ infra/          # implementações concretas das ports (Supabase, WAHA, logger)
├─ jobs/           # DailyCheckJob — roda o usecase para todos os processos
├─ http/           # endpoint HTTP p/ "consultar agora" (RN seção 39)
└─ main.ts         # composition root — único lugar que conhece as classes concretas
```

- **SRP**: cada arquivo tem 1 responsabilidade (o adapter só sabe Playwright/Projudi;
  o repository só sabe Supabase; o usecase só orquestra).
- **OCP**: um novo tribunal = um novo adapter + 1 linha de registro em `main.ts`
  (`sourceRegistry.register(...)`) — `TrackProcessUseCase` não muda.
- **LSP**: qualquer `ProcessDataSource` (o contrato já existe em
  `@juriflow/collectors-core`) é intercambiável.
- **ISP**: ports pequenas e específicas (`ProcessRepository`, `MovementRepository`,
  `Notifier`, `NotificationLog`, `RecipientResolver`) em vez de uma interface gigante.
- **DIP**: `TrackProcessUseCase` só importa tipos de `ports/` e `@juriflow/collectors-core`
  — zero import de `@supabase/supabase-js` ou `playwright` fora de `infra/`/`adapters/`.

## ⚠️ Antes de rodar em produção

Os seletores em `src/adapters/tjam-projudi.selectors.ts` são um ponto de
partida (não foi possível inspecionar o HTML real do formulário — a fonte
bloqueia requisições sem browser). Confirme/ajuste com:

```bash
npm run inspect --workspace @juriflow/scraper-worker -- <numero-do-processo-CNJ>
```

Isso abre um Chromium visível navegando até a consulta pública, para você
comparar com os seletores atuais e corrigi-los se necessário.

## Desenvolvimento local

```bash
cp .env.example .env         # editar com as chaves reais
npm install
npx playwright install chromium   # baixa o browser (não vem com o pacote npm)
npm run dev --workspace @juriflow/scraper-worker
```

## Build/deploy

Ver [`infra/vps/README.md`](../../infra/vps/README.md) — build via Docker
(imagem oficial do Playwright, já com Chromium + libs de sistema).
