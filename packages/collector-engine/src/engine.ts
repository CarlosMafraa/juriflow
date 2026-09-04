import type { ProcessDataSource, SourceTarget } from '@juriflow/collectors-core';
import {
  detectChanges,
  normalizeMovement,
  type CategoryResolver,
  type KnownMovement,
  type SourceKind,
} from '@juriflow/movement-normalizer';
import { classifyError, type ClassifiedError } from './errors.js';

export type RunStatus = 'success' | 'partial' | 'failed';

/** Uma movimentação pronta para `submit_collection_result`. */
export interface MovementRecord {
  content_hash: string;
  source_movement_id: string | null;
  occurred_at: string | null;
  category_code: string | null;
  category_label: string | null;
  description: string;
  raw: unknown;
  needs_review: boolean;
  is_first_sync: boolean;
  revises_content_hash: string | null;
}

export interface EventRecord {
  event_type: 'new_movement' | 'movement_amended' | 'first_sync_completed';
  content_hash: string | null;
  occurred_at: string | null;
  payload: Record<string, unknown>;
}

export interface RunCollectionInput {
  readonly source: ProcessDataSource;
  readonly target: SourceTarget;
  readonly since?: Date | undefined;
  readonly requestId?: string | undefined;
  readonly isFirstSync: boolean;
  readonly known: readonly KnownMovement[];
  readonly previousStateHash: string | null;
  readonly sourceKind: SourceKind;
  readonly resolveCategory: CategoryResolver;
}

export interface RunCollectionOutcome {
  readonly status: RunStatus;
  readonly collectedAt: string;
  readonly rawPayload: unknown;
  readonly movements: readonly MovementRecord[];
  readonly events: readonly EventRecord[];
  readonly stateHash: string;
  readonly firstSyncCompleted: boolean;
  readonly counts: { readonly fetched: number; readonly new: number; readonly updated: number };
  readonly error?: ClassifiedError;
}

/**
 * Núcleo da coleta. Depende apenas do contrato `ProcessDataSource` — nunca de um
 * adapter concreto. Não faz I/O de banco: devolve o plano completo para as RPCs
 * de persistência (`submit_collection_result` / `submit_collection_failure`).
 */
export async function runCollection(input: RunCollectionInput): Promise<RunCollectionOutcome> {
  const collectedAt = new Date().toISOString();

  let fetch: Awaited<ReturnType<ProcessDataSource['fetch']>>;
  try {
    fetch = await input.source.fetch({
      target: input.target,
      ...(input.since ? { since: input.since } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  } catch (err) {
    return {
      status: 'failed',
      collectedAt,
      rawPayload: null,
      movements: [],
      events: [],
      stateHash: input.previousStateHash ?? '',
      firstSyncCompleted: false,
      counts: { fetched: 0, new: 0, updated: 0 },
      error: classifyError(err),
    };
  }

  const partial = fetch.partial === true;
  const canonical = fetch.movements.map((m) =>
    normalizeMovement(m, { sourceKind: input.sourceKind, resolveCategory: input.resolveCategory }),
  );

  const det = detectChanges({
    canonical,
    known: input.known,
    isFirstSync: input.isFirstSync,
    allowFirstSyncComplete: !partial,
  });

  const revisesByHash = new Map(det.amendedMovements.map((a) => [a.movement.contentHash, a.revisesContentHash]));

  const movements: MovementRecord[] = canonical.map((c) => ({
    content_hash: c.contentHash,
    source_movement_id: c.sourceMovementId,
    occurred_at: c.occurredAt,
    category_code: c.categoryCode,
    category_label: c.categoryLabel,
    description: c.description,
    raw: c.raw,
    needs_review: c.needsReview,
    is_first_sync: input.isFirstSync,
    revises_content_hash: revisesByHash.get(c.contentHash) ?? null,
  }));

  const events: EventRecord[] = det.events.map((e) => ({
    event_type: e.eventType,
    content_hash: e.contentHash,
    occurred_at: e.occurredAt,
    payload: e.payload,
  }));

  return {
    status: partial ? 'partial' : 'success',
    collectedAt: fetch.collectedAt ?? collectedAt,
    rawPayload: fetch,
    movements,
    events,
    stateHash: det.stateHash,
    firstSyncCompleted: det.firstSyncCompleted,
    counts: {
      fetched: canonical.length,
      new: input.isFirstSync ? canonical.length : det.newMovements.length,
      updated: det.amendedMovements.length,
    },
  };
}
