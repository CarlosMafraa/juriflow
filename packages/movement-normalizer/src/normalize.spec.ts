import { describe, expect, it } from 'vitest';
import { normalizeMovement } from './normalize.js';
import type { CategoryResolver } from './canonical.js';
import type { RawMovement } from '@juriflow/collectors-core';

const resolver: CategoryResolver = (h) => {
  if (h.code === '26' || /distribu/i.test(h.label ?? '')) return { code: '26', label: 'Distribuição' };
  return null;
};

const ctx = { sourceKind: 'datajud' as const, resolveCategory: resolver };

function raw(o: Partial<RawMovement> & { description: string }): RawMovement {
  return {
    sourceKind: 'datajud',
    sourceMovementId: o.sourceMovementId ?? null,
    occurredAt: o.occurredAt ?? null,
    description: o.description,
    raw: o.raw ?? { description: o.description },
  };
}

describe('normalizeMovement', () => {
  it('normaliza descrição, resolve categoria e produz content_hash determinístico', () => {
    const a = normalizeMovement(
      raw({ description: '  Processo   DISTRIBUÍDO  ', occurredAt: '2024-03-10T13:00:00Z' }),
      ctx,
    );
    const b = normalizeMovement(
      raw({ description: 'Processo distribuído', occurredAt: '2024-03-10T20:00:00Z' }),
      ctx,
    );
    expect(a.description).toBe('Processo DISTRIBUÍDO');
    expect(a.categoryCode).toBe('26');
    // mesmo dia + mesma categoria + descrição equivalente ⇒ mesmo hash
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.needsReview).toBe(false);
  });

  it('marca needsReview quando falta data', () => {
    const m = normalizeMovement(raw({ description: 'Processo distribuído' }), ctx);
    expect(m.occurredAt).toBeNull();
    expect(m.needsReview).toBe(true);
  });

  it('marca needsReview quando a categoria não é reconhecida', () => {
    const m = normalizeMovement(
      raw({ description: 'Ato incomum', occurredAt: '2024-01-01T00:00:00Z' }),
      ctx,
    );
    expect(m.categoryCode).toBeNull();
    expect(m.needsReview).toBe(true);
  });

  it('usa movementCode/movementLabel do raw quando presentes', () => {
    const m = normalizeMovement(
      raw({
        description: 'texto livre',
        occurredAt: '2024-01-01T00:00:00Z',
        raw: { movementCode: '26', movementLabel: 'Distribuição' },
      }),
      ctx,
    );
    expect(m.categoryCode).toBe('26');
  });

  it('data e sourceMovementId diferentes ⇒ hashes diferentes', () => {
    const m1 = normalizeMovement(
      raw({ description: 'Juntada', occurredAt: '2024-01-01T00:00:00Z', sourceMovementId: 'x1' }),
      ctx,
    );
    const m2 = normalizeMovement(
      raw({ description: 'Juntada', occurredAt: '2024-01-02T00:00:00Z', sourceMovementId: 'x1' }),
      ctx,
    );
    const m3 = normalizeMovement(
      raw({ description: 'Juntada', occurredAt: '2024-01-01T00:00:00Z', sourceMovementId: 'x2' }),
      ctx,
    );
    expect(m1.contentHash).not.toBe(m2.contentHash);
    expect(m1.contentHash).not.toBe(m3.contentHash);
  });
});
