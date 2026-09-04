import { describe, expect, it } from 'vitest';
import { detectChanges } from './detect.js';
import type { CanonicalMovement, KnownMovement } from './canonical.js';

function mov(hash: string, sourceMovementId: string | null = null): CanonicalMovement {
  return {
    sourceKind: 'datajud',
    sourceMovementId,
    occurredAt: '2024-01-01T00:00:00.000Z',
    categoryCode: '26',
    categoryLabel: 'Distribuição',
    description: 'x',
    raw: {},
    contentHash: hash,
    needsReview: false,
  };
}
const known = (hash: string, sid: string | null = null): KnownMovement => ({
  contentHash: hash,
  sourceMovementId: sid,
});

describe('detectChanges', () => {
  it('1ª sincronização: nenhum new_movement, só first_sync_completed', () => {
    const r = detectChanges({
      canonical: [mov('a'), mov('b')],
      known: [],
      isFirstSync: true,
      allowFirstSyncComplete: true,
    });
    expect(r.events.map((e) => e.eventType)).toEqual(['first_sync_completed']);
    expect(r.firstSyncCompleted).toBe(true);
  });

  it('1ª sincronização parcial: não fecha first_sync_completed', () => {
    const r = detectChanges({
      canonical: [mov('a')],
      known: [],
      isFirstSync: true,
      allowFirstSyncComplete: false,
    });
    expect(r.events).toHaveLength(0);
    expect(r.firstSyncCompleted).toBe(false);
  });

  it('coleta seguinte: content_hash novo ⇒ new_movement', () => {
    const r = detectChanges({
      canonical: [mov('a'), mov('c')],
      known: [known('a'), known('b')],
      isFirstSync: false,
      allowFirstSyncComplete: true,
    });
    expect(r.newMovements.map((m) => m.contentHash)).toEqual(['c']);
    expect(r.events.map((e) => e.eventType)).toEqual(['new_movement']);
  });

  it('idempotência: reprocessar os mesmos hashes ⇒ 0 eventos', () => {
    const r = detectChanges({
      canonical: [mov('a'), mov('b')],
      known: [known('a'), known('b')],
      isFirstSync: false,
      allowFirstSyncComplete: true,
    });
    expect(r.newMovements).toHaveLength(0);
    expect(r.events).toHaveLength(0);
  });

  it('movimentação alterada: mesmo source_movement_id, hash diferente ⇒ movement_amended + revision_of', () => {
    const r = detectChanges({
      canonical: [mov('a2', 'S1')],
      known: [known('a1', 'S1')],
      isFirstSync: false,
      allowFirstSyncComplete: true,
    });
    expect(r.newMovements).toHaveLength(0);
    expect(r.amendedMovements).toEqual([
      { movement: expect.objectContaining({ contentHash: 'a2' }), revisesContentHash: 'a1' },
    ]);
    expect(r.events.map((e) => e.eventType)).toEqual(['movement_amended']);
  });

  it('state_hash é estável e independe da ordem', () => {
    const r1 = detectChanges({
      canonical: [mov('b'), mov('a')],
      known: [],
      isFirstSync: false,
      allowFirstSyncComplete: true,
    });
    const r2 = detectChanges({
      canonical: [mov('a'), mov('b')],
      known: [],
      isFirstSync: false,
      allowFirstSyncComplete: true,
    });
    expect(r1.stateHash).toBe(r2.stateHash);
  });
});
