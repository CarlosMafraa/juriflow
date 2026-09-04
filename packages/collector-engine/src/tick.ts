import { SourceRegistry, type SourceTarget } from '@juriflow/collectors-core';
import type { CategoryResolver, KnownMovement } from '@juriflow/movement-normalizer';
import { runCollection } from './engine.js';

/** Interface mínima de RPC (compatível com o cliente do @supabase/supabase-js). */
export interface TickRpc {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface TickDeps {
  readonly rpc: TickRpc;
  readonly registry: SourceRegistry;
  readonly resolveCategory: CategoryResolver;
  readonly maxRuns?: number;
}

interface ClaimData {
  run_id: string;
  process_id: string;
  space_id: string;
  source_kind: string;
  trigger: string;
  attempt: number;
  cnj_number: string | null;
  court_id: string;
  source_params: Record<string, unknown>;
  is_first_sync: boolean;
  since: string | null;
  state_hash_before: string | null;
  known: { content_hash: string; source_movement_id: string | null }[];
}

/**
 * Um "tick" do runtime de coleta da Acompanhamento-A: reclama execuções
 * pendentes, roda o motor contra a fonte resolvida no `SourceRegistry`
 * (na Acompanhamento-A: o `MockSourceAdapter`) e envia o resultado de volta.
 *
 * NÃO é o worker de produção (Acompanhamento-C). É a cola mínima para dev/testes.
 */
export async function runCollectorTick(
  deps: TickDeps,
): Promise<{ processed: number; failed: number }> {
  const max = deps.maxRuns ?? 50;
  let processed = 0;
  let failed = 0;

  for (let i = 0; i < max; i++) {
    const claim = await deps.rpc.rpc('claim_pending_collection_run');
    if (claim.error) throw new Error(`claim_pending_collection_run: ${claim.error.message}`);
    if (claim.data == null) break;

    const c = claim.data as ClaimData;
    const target: SourceTarget = {
      cnjNumber: c.cnj_number,
      courtId: c.court_id,
      params: c.source_params,
    };
    const source = deps.registry.create(c.source_kind);
    const known: KnownMovement[] = c.known.map((k) => ({
      contentHash: k.content_hash,
      sourceMovementId: k.source_movement_id,
    }));

    const outcome = await runCollection({
      source,
      target,
      since: c.since ? new Date(c.since) : undefined,
      requestId: c.run_id,
      isFirstSync: c.is_first_sync,
      known,
      previousStateHash: c.state_hash_before,
      sourceKind: c.source_kind,
      resolveCategory: deps.resolveCategory,
    });

    if (outcome.status === 'failed') {
      const err = outcome.error!;
      const res = await deps.rpc.rpc('submit_collection_failure', {
        p_run_id: c.run_id,
        p_error: {
          error_code: err.code,
          error_message: err.message,
          http_status: err.httpStatus ?? null,
          retriable: err.retriable,
        },
      });
      if (res.error) throw new Error(`submit_collection_failure: ${res.error.message}`);
      failed++;
    } else {
      const res = await deps.rpc.rpc('submit_collection_result', {
        p_run_id: c.run_id,
        p_result: {
          status: outcome.status,
          collected_at: outcome.collectedAt,
          raw_payload: outcome.rawPayload,
          movements: outcome.movements,
          events: outcome.events,
          state_hash: outcome.stateHash,
          first_sync_completed: outcome.firstSyncCompleted,
          counts: outcome.counts,
        },
      });
      if (res.error) throw new Error(`submit_collection_result: ${res.error.message}`);
      processed++;
    }
  }

  return { processed, failed };
}
