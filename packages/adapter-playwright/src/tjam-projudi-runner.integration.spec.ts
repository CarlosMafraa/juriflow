import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { runCollection } from '@juriflow/collector-engine';

import { PlaywrightCollector } from './playwright-collector.js';
import { TjamProjudiEdgeRunner } from './tjam-projudi-runner.js';

/**
 * TESTE REAL — Playwright + Microsoft Edge + PROJUDI Consulta Pública do TJAM.
 *
 * Só roda com `JURIFLOW_TEST_PROJUDI=1` (abre o Edge, acessa a internet, ~30–90s).
 * CNJ configurável por `JURIFLOW_TEST_PROJUDI_CNJ`; default = um processo público
 * conhecido do TJAM.
 *
 *   JURIFLOW_TEST_PROJUDI=1 npx vitest run packages/adapter-playwright
 */
const ENABLED = process.env['JURIFLOW_TEST_PROJUDI'] === '1';
const CNJ = process.env['JURIFLOW_TEST_PROJUDI_CNJ'] ?? '0280181-52.2025.8.04.1000';
const PROFILE = fileURLToPath(new URL('../../../.cache/projudi-edge-it-profile', import.meta.url));

describe.skipIf(!ENABLED)('TjamProjudiEdgeRunner — REAL (Edge + PROJUDI/TJAM)', () => {
  it(
    'consulta o CNJ, abre o Edge, extrai movimentações e devolve no contrato da Etapa 9',
    async () => {
      const runner = new TjamProjudiEdgeRunner({
        headless: false,
        timeoutMs: 120_000,
        userDataDir: PROFILE,
      });

      const outcome = await runner.run({ cnjNumber: CNJ, courtId: 'tjam', requestId: 'it-1' });

      expect(outcome.status).toBe('found');
      if (outcome.status !== 'found') return;

      expect(outcome.movements.length).toBeGreaterThanOrEqual(1);
      const first = outcome.movements[0];
      expect(first?.description).toBeTruthy();
      expect(first?.sourceMovementId).toMatch(/^\d+$/);
      // occurredAt convertido para ISO pelo parser
      expect(first?.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      console.error(
        `[IT PROJUDI] ${outcome.movements.length} movimentações; última:`,
        JSON.stringify(outcome.movements.at(-1)),
      );
    },
    150_000,
  );

  it(
    'pelo PlaywrightCollector (contrato ProcessDataSource) + runCollection: gera content_hash/state_hash',
    async () => {
      const source = new PlaywrightCollector({
        kind: 'projudi_tjam',
        runner: new TjamProjudiEdgeRunner({ headless: false, timeoutMs: 120_000, userDataDir: PROFILE }),
      });

      const out = await runCollection({
        source,
        target: { cnjNumber: CNJ, courtId: 'tjam' },
        isFirstSync: true,
        known: [],
        previousStateHash: null,
        sourceKind: 'projudi_tjam',
        resolveCategory: () => null,
      });

      expect(out.status).toBe('success');
      expect(out.movements.length).toBeGreaterThanOrEqual(1);
      expect(out.movements[0]?.content_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(out.stateHash).toMatch(/^[0-9a-f]{64}$/);
    },
    150_000,
  );
});
