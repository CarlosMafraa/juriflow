/**
 * Integração do `DataJudAdapter` com o `runCollection` do `@juriflow/collector-engine`
 * (motor não é alterado). Cobre 1ª sincronização, idempotência, movimento novo,
 * texto diferente ⇒ novo movimento (DJ-3, sem heurística de emenda) e `partial`.
 */
import { runCollection } from '@juriflow/collector-engine';
import type { CategoryResolver, KnownMovement } from '@juriflow/movement-normalizer';
import { describe, expect, it } from 'vitest';
import { DataJudAdapter, type DataJudStrategy } from './datajud-adapter.js';
import {
  envelopeHuge,
  envelopeWithMovements,
  envelopeZeroHits,
  fakeResponse,
} from './testing/index.js';

const API_KEY = 'itest-key-not-real';
const STRATEGY: DataJudStrategy = { alias: 'api_publica_tjxx', maxMovements: 5000 };
const TARGET = { cnjNumber: '0000832-50.2023.8.04.0001', courtId: 'court-1', params: {} };

const CATS: Record<string, { code: string; label: string }> = {
  '26': { code: '26', label: 'Distribuição' },
  '132': { code: '132', label: 'Juntada' },
  '848': { code: '848', label: 'Sentença' },
};
const resolveCategory: CategoryResolver = ({ code }) => (code && CATS[code]) || null;

function adapterFor(body: unknown, strategy: DataJudStrategy = STRATEGY): DataJudAdapter {
  return new DataJudAdapter({
    apiKey: API_KEY,
    resolveStrategy: () => strategy,
    endpointBase: 'https://datajud.example.test',
    fetchFn: async () => fakeResponse(200, body),
    now: () => new Date('2024-05-01T00:00:00.000Z'),
  });
}

function baseInput(
  source: DataJudAdapter,
  over: Record<string, unknown> = {},
): Parameters<typeof runCollection>[0] {
  return {
    source,
    target: TARGET,
    isFirstSync: true,
    known: [] as KnownMovement[],
    previousStateHash: null,
    sourceKind: 'datajud',
    resolveCategory,
    ...over,
  };
}

describe('DataJud × runCollection', () => {
  it('1ª sincronização: success, first_sync_completed, sem new_movement, movimentos com is_first_sync', async () => {
    const out = await runCollection(baseInput(adapterFor(envelopeWithMovements)));

    expect(out.status).toBe('success');
    expect(out.firstSyncCompleted).toBe(true);
    expect(out.movements).toHaveLength(4);
    expect(out.movements.every((m) => m.is_first_sync)).toBe(true);
    expect(out.movements.every((m) => m.source_movement_id === null)).toBe(true);
    expect(out.events.map((e) => e.event_type)).toEqual(['first_sync_completed']);
    // código fora da taxonomia curada ⇒ needs_review
    expect(out.movements[3].needs_review).toBe(true);
    expect(out.movements[0].category_code).toBe('26');
  });

  it('idempotência: re-executar com os hashes conhecidos ⇒ 0 novos, 0 eventos, state_hash estável', async () => {
    const first = await runCollection(baseInput(adapterFor(envelopeWithMovements)));
    const known: KnownMovement[] = first.movements.map((m) => ({
      contentHash: m.content_hash,
      sourceMovementId: m.source_movement_id,
    }));

    const second = await runCollection(
      baseInput(adapterFor(envelopeWithMovements), {
        isFirstSync: false,
        known,
        previousStateHash: first.stateHash,
      }),
    );

    expect(second.counts.new).toBe(0);
    expect(second.events).toHaveLength(0);
    expect(second.stateHash).toBe(first.stateHash);
  });

  it('movimento adicional ⇒ um new_movement e state_hash muda', async () => {
    const first = await runCollection(baseInput(adapterFor(envelopeWithMovements)));
    const known: KnownMovement[] = first.movements.map((m) => ({
      contentHash: m.content_hash,
      sourceMovementId: m.source_movement_id,
    }));

    const withExtra = structuredClone(envelopeWithMovements) as Record<string, unknown>;
    const source = (withExtra as { hits: { hits: { _source: { movimentos: unknown[] } }[] } }).hits
      .hits[0]._source;
    source.movimentos.push({ codigo: 132, nome: 'Juntada', dataHora: '2024-04-10T09:00:00.000Z' });

    const next = await runCollection(
      baseInput(adapterFor(withExtra), {
        isFirstSync: false,
        known,
        previousStateHash: first.stateHash,
      }),
    );

    expect(next.counts.new).toBe(1);
    expect(next.events.map((e) => e.event_type)).toEqual(['new_movement']);
    expect(next.stateHash).not.toBe(first.stateHash);
  });

  it('texto diferente no mesmo movimento ⇒ new_movement (sem heurística de emenda — DJ-3)', async () => {
    const first = await runCollection(baseInput(adapterFor(envelopeWithMovements)));
    const known: KnownMovement[] = first.movements.map((m) => ({
      contentHash: m.content_hash,
      sourceMovementId: m.source_movement_id,
    }));

    const edited = structuredClone(envelopeWithMovements) as {
      hits: { hits: { _source: { movimentos: { nome: string }[] } }[] };
    };
    edited.hits.hits[0]._source.movimentos[1].nome = 'Juntada de novos documentos';

    const next = await runCollection(
      baseInput(adapterFor(edited), {
        isFirstSync: false,
        known,
        previousStateHash: first.stateHash,
      }),
    );

    expect(next.counts.updated).toBe(0);
    expect(next.counts.new).toBe(1);
    expect(next.events.map((e) => e.event_type)).toEqual(['new_movement']);
  });

  it('acima de max_movements ⇒ status partial e 1ª sincronização não fecha', async () => {
    const out = await runCollection(
      baseInput(adapterFor(envelopeHuge(30), { alias: 'a', maxMovements: 10 })),
    );
    expect(out.status).toBe('partial');
    expect(out.firstSyncCompleted).toBe(false);
    expect(out.movements).toHaveLength(10);
  });

  it('processo ausente no DataJud ⇒ success com 0 movimentos, sem erro (DJ-8)', async () => {
    const out = await runCollection(baseInput(adapterFor(envelopeZeroHits)));
    expect(out.status).toBe('success');
    expect(out.error).toBeUndefined();
    expect(out.movements).toHaveLength(0);
    expect(out.firstSyncCompleted).toBe(true);
  });
});
