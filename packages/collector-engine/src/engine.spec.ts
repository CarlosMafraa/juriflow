import { describe, expect, it } from 'vitest';
import { runCollection } from './engine.js';
import { classifyError } from './errors.js';
import { MockSourceAdapter, rawMovement } from './testing/mock-source-adapter.js';
import type { CategoryResolver } from '@juriflow/movement-normalizer';

const resolveCategory: CategoryResolver = (h) =>
  h.code === '26' || /distribu/i.test(h.label ?? '') ? { code: '26', label: 'Distribuição' } : null;

const target = { cnjNumber: '0000001-23.2024.8.04.0001', courtId: 'court-1' };
const base = {
  target,
  sourceKind: 'datajud' as const,
  resolveCategory,
  previousStateHash: null,
};

describe('runCollection — sucesso', () => {
  it('1ª coleta: movimentações com is_first_sync e só first_sync_completed', async () => {
    const source = new MockSourceAdapter({
      pages: [
        [rawMovement({ description: 'Distribuído', occurredAt: '2024-03-01T00:00:00Z', sourceMovementId: 'S1' })],
        [rawMovement({ description: 'Juntada', occurredAt: '2024-03-05T00:00:00Z', sourceMovementId: 'S2' })],
      ],
    });
    const out = await runCollection({ ...base, source, isFirstSync: true, known: [] });
    expect(out.status).toBe('success');
    expect(out.movements).toHaveLength(2);
    expect(out.movements.every((m) => m.is_first_sync)).toBe(true);
    expect(out.events.map((e) => e.event_type)).toEqual(['first_sync_completed']);
    expect(out.firstSyncCompleted).toBe(true);
    expect(out.counts).toEqual({ fetched: 2, new: 2, updated: 0 });
  });

  it('coleta seguinte: nova movimentação gera new_movement; reprocessar não duplica', async () => {
    const m1 = rawMovement({ description: 'Distribuído', occurredAt: '2024-03-01T00:00:00Z', sourceMovementId: 'S1' });
    const m2 = rawMovement({ description: 'Juntada', occurredAt: '2024-03-05T00:00:00Z', sourceMovementId: 'S2' });

    const first = await runCollection({
      ...base,
      source: new MockSourceAdapter({ pages: [[m1]] }),
      isFirstSync: true,
      known: [],
    });
    const known = first.movements.map((m) => ({ contentHash: m.content_hash, sourceMovementId: m.source_movement_id }));

    const second = await runCollection({
      ...base,
      source: new MockSourceAdapter({ pages: [[m1, m2]] }),
      isFirstSync: false,
      known,
    });
    expect(second.events.map((e) => e.event_type)).toEqual(['new_movement']);
    expect(second.counts.new).toBe(1);

    const third = await runCollection({
      ...base,
      source: new MockSourceAdapter({ pages: [[m1, m2]] }),
      isFirstSync: false,
      known: [
        ...known,
        ...second.movements
          .filter((m) => !known.some((k) => k.contentHash === m.content_hash))
          .map((m) => ({ contentHash: m.content_hash, sourceMovementId: m.source_movement_id })),
      ],
    });
    expect(third.events).toHaveLength(0);
    expect(third.counts.new).toBe(0);
  });

  it('movimentação alterada: revises_content_hash + movement_amended', async () => {
    const v1 = rawMovement({ description: 'Decisão proferida', occurredAt: '2024-04-01T00:00:00Z', sourceMovementId: 'S9' });
    const first = await runCollection({
      ...base,
      source: new MockSourceAdapter({ pages: [[v1]] }),
      isFirstSync: true,
      known: [],
    });
    const known = first.movements.map((m) => ({ contentHash: m.content_hash, sourceMovementId: m.source_movement_id }));

    const v2 = rawMovement({
      description: 'Decisão proferida (retificada)',
      occurredAt: '2024-04-01T00:00:00Z',
      sourceMovementId: 'S9',
    });
    const out = await runCollection({
      ...base,
      source: new MockSourceAdapter({ pages: [[v2]] }),
      isFirstSync: false,
      known,
    });
    expect(out.events.map((e) => e.event_type)).toEqual(['movement_amended']);
    expect(out.movements[0]!.revises_content_hash).toBe(known[0]!.contentHash);
    expect(out.counts.updated).toBe(1);
  });

  it('coleta parcial: status partial e sem first_sync_completed', async () => {
    const source = new MockSourceAdapter({
      pages: [[rawMovement({ description: 'p1' })], [rawMovement({ description: 'p2' })], [rawMovement({ description: 'p3' })]],
      partialAfterPage: 1,
    });
    const out = await runCollection({ ...base, source, isFirstSync: true, known: [] });
    expect(out.status).toBe('partial');
    expect(out.firstSyncCompleted).toBe(false);
    expect(out.events).toHaveLength(0);
    expect(out.movements).toHaveLength(1);
  });
});

describe('runCollection — falhas', () => {
  it.each([
    ['timeout', true],
    ['unavailable', true],
    ['rate_limited', true],
    ['auth_failed', false],
    ['parse_error', false],
    ['not_found', false],
  ] as const)('classifica %s (retriable=%s)', async (failWith, retriable) => {
    const out = await runCollection({
      ...base,
      source: new MockSourceAdapter({ failWith }),
      isFirstSync: true,
      known: [],
    });
    expect(out.status).toBe('failed');
    expect(out.error?.code).toBe(failWith);
    expect(out.error?.retriable).toBe(retriable);
  });

  it('erro desconhecido é retriável (limitado)', () => {
    expect(classifyError(new Error('boom'))).toEqual({
      code: 'unknown',
      message: 'boom',
      retriable: true,
    });
  });

  it('SourceUnavailableError do collectors-core vira unavailable/retriável', async () => {
    const out = await runCollection({
      ...base,
      source: new MockSourceAdapter({ failWith: 'source_unavailable' }),
      isFirstSync: true,
      known: [],
    });
    expect(out.error?.code).toBe('unavailable');
    expect(out.error?.retriable).toBe(true);
  });
});
