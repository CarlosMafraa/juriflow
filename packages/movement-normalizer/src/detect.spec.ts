import { describe, expect, it } from 'vitest';
import { detectChanges } from './detect.js';
import type { CanonicalMovement, KnownMovement } from './canonical.js';
import contractVectors from '../../../contracts/collector-engine/detect-changes.json' with { type: 'json' };

/**
 * Vetores de contrato compartilhados com a futura implementação Go
 * (Acompanhamento-F, decisões F-1/F-2) — ver nota equivalente em
 * `normalize.spec.ts`. Gerados por `scripts/extract-contract-vectors.mjs`.
 */
const [vec0, vec1, vec2, vec3, vec4, vec5, vec6] = contractVectors.vectors;

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
    expect(r.stateHash).toBe(vec0.expected.stateHash);
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
    expect(r.stateHash).toBe(vec1.expected.stateHash);
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
    expect(r.stateHash).toBe(vec2.expected.stateHash);
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
    expect(r.stateHash).toBe(vec3.expected.stateHash);
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
    expect(r.stateHash).toBe(vec4.expected.stateHash);
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
    expect(r1.stateHash).toBe(vec5.expected.stateHash);
    expect(r2.stateHash).toBe(vec6.expected.stateHash);
  });
});
