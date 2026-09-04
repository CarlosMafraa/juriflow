import type { RawMovement } from '@juriflow/collectors-core';
import type { CanonicalMovement, NormalizeContext } from './canonical.js';
import { sha256Hex } from './hash.js';
import { isoDay, normalizeDescription, normalizeForHash } from './text.js';

function toIso(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function readHint(raw: unknown): { code: string | null; label: string | null } {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const code = typeof r['movementCode'] === 'string' ? r['movementCode'] : null;
    const label = typeof r['movementLabel'] === 'string' ? r['movementLabel'] : null;
    return { code, label };
  }
  return { code: null, label: null };
}

/**
 * Converte uma `RawMovement` (do adapter) na `CanonicalMovement` do JuriFlow.
 * Puro. NÃO importa adapters concretos.
 */
export function normalizeMovement(raw: RawMovement, ctx: NormalizeContext): CanonicalMovement {
  const occurredAt = toIso(raw.occurredAt);
  const description = normalizeDescription(raw.description ?? '');

  const hint = readHint(raw.raw);
  const category = ctx.resolveCategory({
    code: hint.code,
    label: hint.label ?? description,
  });

  const categoryKey = category?.code ?? normalizeForHash(hint.label ?? description);
  const contentHash = sha256Hex([
    isoDay(occurredAt),
    categoryKey,
    normalizeForHash(description),
    raw.sourceMovementId ?? '',
    ctx.sourceKind,
  ]);

  return {
    sourceKind: ctx.sourceKind,
    sourceMovementId: raw.sourceMovementId ?? null,
    occurredAt,
    categoryCode: category?.code ?? null,
    categoryLabel: category?.label ?? hint.label ?? null,
    description,
    raw: raw.raw,
    contentHash,
    needsReview: occurredAt === null || category === null,
  };
}
