import type { CanonicalMovement, KnownMovement } from './canonical.js';
import { stateHashOf } from './hash.js';

export type TrackingEventType = 'new_movement' | 'movement_amended' | 'first_sync_completed';

export interface DetectedEvent {
  readonly eventType: TrackingEventType;
  readonly contentHash: string | null;
  readonly occurredAt: string | null;
  readonly payload: Record<string, unknown>;
}

export interface AmendedMovement {
  readonly movement: CanonicalMovement;
  readonly revisesContentHash: string;
}

export interface DetectInput {
  readonly canonical: readonly CanonicalMovement[];
  readonly known: readonly KnownMovement[];
  readonly isFirstSync: boolean;
  /** false quando a coleta veio parcial — não fecha a 1ª sincronização. */
  readonly allowFirstSyncComplete: boolean;
}

export interface DetectResult {
  readonly stateHash: string;
  readonly newMovements: readonly CanonicalMovement[];
  readonly amendedMovements: readonly AmendedMovement[];
  readonly events: readonly DetectedEvent[];
  readonly firstSyncCompleted: boolean;
}

function eventPayload(m: CanonicalMovement): Record<string, unknown> {
  return {
    category_code: m.categoryCode,
    category_label: m.categoryLabel,
    description: m.description.slice(0, 280),
    source_kind: m.sourceKind,
  };
}

/**
 * Detector de mudanças. Puro. Recebe o estado conhecido + a coleta atual e
 * devolve o novo `state_hash`, as movimentações novas/alteradas e os eventos.
 * RN11: na 1ª sincronização não emite `new_movement`, apenas `first_sync_completed`.
 */
export function detectChanges(input: DetectInput): DetectResult {
  const knownHashes = new Set(input.known.map((k) => k.contentHash));
  const knownBySourceId = new Map<string, string>();
  for (const k of input.known) {
    if (k.sourceMovementId) knownBySourceId.set(k.sourceMovementId, k.contentHash);
  }

  const allHashes = [...knownHashes, ...input.canonical.map((c) => c.contentHash)];
  const stateHash = stateHashOf(allHashes);

  const newMovements: CanonicalMovement[] = [];
  const amendedMovements: AmendedMovement[] = [];

  for (const c of input.canonical) {
    if (knownHashes.has(c.contentHash)) continue;
    const priorHashForSourceId =
      c.sourceMovementId != null ? knownBySourceId.get(c.sourceMovementId) : undefined;
    if (priorHashForSourceId != null && priorHashForSourceId !== c.contentHash) {
      amendedMovements.push({ movement: c, revisesContentHash: priorHashForSourceId });
    } else {
      newMovements.push(c);
    }
  }

  const events: DetectedEvent[] = [];
  let firstSyncCompleted = false;

  if (input.isFirstSync) {
    if (input.allowFirstSyncComplete) {
      firstSyncCompleted = true;
      events.push({
        eventType: 'first_sync_completed',
        contentHash: null,
        occurredAt: null,
        payload: { source_kind: input.canonical[0]?.sourceKind ?? null, movements: input.canonical.length },
      });
    }
  } else {
    for (const m of newMovements) {
      events.push({
        eventType: 'new_movement',
        contentHash: m.contentHash,
        occurredAt: m.occurredAt,
        payload: eventPayload(m),
      });
    }
    for (const a of amendedMovements) {
      events.push({
        eventType: 'movement_amended',
        contentHash: a.movement.contentHash,
        occurredAt: a.movement.occurredAt,
        payload: { ...eventPayload(a.movement), revises: a.revisesContentHash },
      });
    }
  }

  return { stateHash, newMovements, amendedMovements, events, firstSyncCompleted };
}
