import { describe, expect, it } from 'vitest';

import { CollectionError, CollectionNotFoundError, runCollection } from '@juriflow/collector-engine';
import type { SourceTarget } from '@juriflow/collectors-core';

import { PlaywrightCollector } from './playwright-collector.js';
import { FakeBrowserCaseRunner, fakeMovement } from './testing/index.js';

const target = (over: Partial<SourceTarget> = {}): SourceTarget => ({
  cnjNumber: '0280181-52.2025.8.04.1000',
  courtId: 'court-tjam',
  ...over,
});

const at = (iso: string) => (): Date => new Date(iso);

describe('PlaywrightCollector — contrato ProcessDataSource', () => {
  it('kind é "projudi_tjam" por padrão e configurável', () => {
    expect(new PlaywrightCollector({ runner: new FakeBrowserCaseRunner() }).kind).toBe('projudi_tjam');
    expect(
      new PlaywrightCollector({ runner: new FakeBrowserCaseRunner(), kind: 'datajud' }).kind,
    ).toBe('datajud');
  });

  it('canHandle: exige número CNJ', () => {
    const c = new PlaywrightCollector({ runner: new FakeBrowserCaseRunner() });
    expect(c.canHandle(target())).toBe(true);
    expect(c.canHandle(target({ cnjNumber: null }))).toBe(false);
    expect(c.canHandle(target({ cnjNumber: '   ' }))).toBe(false);
  });

  it('processo encontrado: mapeia BrowserMovement → RawMovement e repassa a consulta', async () => {
    const runner = new FakeBrowserCaseRunner({
      outcome: {
        status: 'found',
        movements: [
          fakeMovement({ sourceMovementId: '69', occurredAt: '2026-09-03T11:51:37', description: 'EXPEDIÇÃO DE INTIMAÇÃO' }),
          fakeMovement({ description: 'Distribuído por sorteio' }),
        ],
      },
    });
    const c = new PlaywrightCollector({ runner, kind: 'projudi_tjam', now: at('2026-09-08T12:00:00.000Z') });

    const res = await c.fetch({
      target: target({ params: { instancia: '1' } }),
      requestId: 'req-1',
    });

    expect(res.sourceKind).toBe('projudi_tjam');
    expect(res.collectedAt).toBe('2026-09-08T12:00:00.000Z');
    expect(res.partial).toBeUndefined();
    expect(res.movements).toEqual([
      {
        sourceKind: 'projudi_tjam',
        sourceMovementId: '69',
        occurredAt: '2026-09-03T11:51:37',
        description: 'EXPEDIÇÃO DE INTIMAÇÃO',
        raw: { description: 'EXPEDIÇÃO DE INTIMAÇÃO' },
      },
      {
        sourceKind: 'projudi_tjam',
        sourceMovementId: null,
        occurredAt: null,
        description: 'Distribuído por sorteio',
        raw: { description: 'Distribuído por sorteio' },
      },
    ]);
    expect(runner.calls).toEqual([
      {
        cnjNumber: '0280181-52.2025.8.04.1000',
        courtId: 'court-tjam',
        params: { instancia: '1' },
        requestId: 'req-1',
      },
    ]);
  });

  it('coleta parcial: propaga partial=true', async () => {
    const runner = new FakeBrowserCaseRunner({
      outcome: { status: 'found', movements: [fakeMovement({ description: 'x' })], partial: true },
    });
    const res = await new PlaywrightCollector({ runner }).fetch({ target: target() });
    expect(res.partial).toBe(true);
  });

  it('processo não encontrado: lança CollectionNotFoundError (code not_found, não retriável)', async () => {
    const runner = new FakeBrowserCaseRunner({ outcome: { status: 'not_found' } });
    const c = new PlaywrightCollector({ runner });
    await expect(c.fetch({ target: target() })).rejects.toBeInstanceOf(CollectionNotFoundError);
    await c.fetch({ target: target() }).catch((e: unknown) => {
      expect(e).toBeInstanceOf(CollectionError);
      const err = e as CollectionError;
      expect(err.code).toBe('not_found');
      expect(err.retriable).toBe(false);
    });
  });

  it('erro de consulta: o CollectionError lançado pelo runner sobe intacto', async () => {
    const boom = new CollectionError('unavailable', 'tribunal fora do ar', true);
    const runner = new FakeBrowserCaseRunner({ throws: boom });
    await expect(new PlaywrightCollector({ runner }).fetch({ target: target() })).rejects.toBe(boom);
  });

  it('alvo sem CNJ: resultado vazio (não é falha)', async () => {
    const runner = new FakeBrowserCaseRunner();
    const res = await new PlaywrightCollector({ runner, now: at('2026-09-08T12:00:00.000Z') }).fetch({
      target: target({ cnjNumber: null }),
    });
    expect(res).toEqual({ sourceKind: 'projudi_tjam', collectedAt: '2026-09-08T12:00:00.000Z', movements: [] });
    expect(runner.calls).toHaveLength(0);
  });
});

describe('PlaywrightCollector — encaixa no pipeline existente (sem site)', () => {
  it('runCollection consome o collector: normaliza, gera content_hash e state_hash', async () => {
    const runner = new FakeBrowserCaseRunner({
      outcome: {
        status: 'found',
        movements: [
          fakeMovement({ sourceMovementId: '1', occurredAt: '2026-09-03T11:51:37Z', description: 'Distribuído' }),
        ],
      },
    });
    const source = new PlaywrightCollector({ runner });

    const out = await runCollection({
      source,
      target: target(),
      isFirstSync: true,
      known: [],
      previousStateHash: null,
      sourceKind: 'projudi_tjam',
      resolveCategory: () => null,
    });

    expect(out.status).toBe('success');
    expect(out.movements).toHaveLength(1);
    expect(out.movements[0]?.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(out.stateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(out.firstSyncCompleted).toBe(true);
  });
});
