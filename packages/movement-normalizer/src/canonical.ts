import type { RawMovement, SourceKind } from '@juriflow/collectors-core';

export type { RawMovement, SourceKind };

/** Movimentação já normalizada para o modelo interno do JuriFlow. */
export interface CanonicalMovement {
  readonly sourceKind: SourceKind;
  readonly sourceMovementId: string | null;
  /** ISO-8601, ou null se a fonte não informou / valor inválido. */
  readonly occurredAt: string | null;
  readonly categoryCode: string | null;
  readonly categoryLabel: string | null;
  /** Texto normalizado para exibição. O original fica em `raw`. */
  readonly description: string;
  readonly raw: unknown;
  readonly contentHash: string;
  /** true quando falta data ou categoria — a revisão manual é feita depois. */
  readonly needsReview: boolean;
}

export interface CategoryHint {
  readonly code?: string | null | undefined;
  readonly label?: string | null | undefined;
}

export type CategoryResolver = (hint: CategoryHint) => { code: string; label: string } | null;

export interface NormalizeContext {
  readonly sourceKind: SourceKind;
  readonly resolveCategory: CategoryResolver;
}

export interface KnownMovement {
  readonly contentHash: string;
  readonly sourceMovementId: string | null;
}
