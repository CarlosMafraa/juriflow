import { describe, expect, it } from 'vitest';
import { normalizeMovement } from './normalize.js';
import type { CategoryResolver } from './canonical.js';
import type { RawMovement } from '@juriflow/collectors-core';
import contractVectors from '../../../contracts/collector-engine/normalize-movement.json' with { type: 'json' };

/**
 * Vetores de contrato compartilhados com a futura implementação Go do
 * collector-engine (Acompanhamento-F, decisões F-1/F-2). Os valores abaixo
 * (`vec0`..`vec7`) são os mesmos vetores que um `go test` equivalente vai
 * consumir — cada `it()` original permanece validando exatamente o que já
 * validava; as linhas `expect(...).toBe(vecN.expected...)` só fixam (pinam)
 * o valor gravado em `contracts/collector-engine/normalize-movement.json`,
 * gerado por `scripts/extract-contract-vectors.mjs`. Se este arquivo mudar
 * de comportamento intencionalmente, reexecute o script para regravar os
 * vetores — nunca edite o JSON à mão.
 */
const [vec0, vec1, vec2, vec3, vec4, vec5, vec6, vec7] = contractVectors.vectors;

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
    // vetor de contrato (TS↔Go) — fixa o content_hash gravado
    expect(a.contentHash).toBe(vec0.expected.contentHash);
    expect(b.contentHash).toBe(vec1.expected.contentHash);
  });

  it('marca needsReview quando falta data', () => {
    const m = normalizeMovement(raw({ description: 'Processo distribuído' }), ctx);
    expect(m.occurredAt).toBeNull();
    expect(m.needsReview).toBe(true);
    expect(m.contentHash).toBe(vec2.expected.contentHash);
  });

  it('marca needsReview quando a categoria não é reconhecida', () => {
    const m = normalizeMovement(
      raw({ description: 'Ato incomum', occurredAt: '2024-01-01T00:00:00Z' }),
      ctx,
    );
    expect(m.categoryCode).toBeNull();
    expect(m.needsReview).toBe(true);
    expect(m.contentHash).toBe(vec3.expected.contentHash);
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
    expect(m.contentHash).toBe(vec4.expected.contentHash);
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
    expect(m1.contentHash).toBe(vec5.expected.contentHash);
    expect(m2.contentHash).toBe(vec6.expected.contentHash);
    expect(m3.contentHash).toBe(vec7.expected.contentHash);
  });

  it.each(contractVectors.invariants)(
    'invariante de contrato: $name',
    ({ equalContentHashOf }) => {
      const [nameA, nameB] = equalContentHashOf;
      const a = contractVectors.vectors.find((v) => v.name === nameA)!;
      const b = contractVectors.vectors.find((v) => v.name === nameB)!;
      expect(normalizeMovement(a.raw as RawMovement, ctx).contentHash).toBe(
        normalizeMovement(b.raw as RawMovement, ctx).contentHash,
      );
    },
  );
});
