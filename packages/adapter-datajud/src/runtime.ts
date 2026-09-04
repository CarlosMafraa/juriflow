/**
 * Runtime de lote do DataJud.
 *
 * Reimplementa o laço `claim → runCollection → submit` (equivalente ao
 * `runCollectorTick` da Acompanhamento-A) acrescentando **espaçamento entre
 * requisições** — necessário para respeitar o limite de ~120 req/min da API
 * Pública do DataJud. Não altera o `collector-engine`: consome `runCollection`
 * exatamente como está.
 *
 * `claim` → `fetch` → `submit` são contíguos (uma `collection_run` nunca fica em
 * `running` durante o intervalo artificial): o `sleep` acontece **depois** de
 * cada run processada, antes do próximo `claim`.
 *
 * Reusa integralmente as RPCs da Acompanhamento-A:
 *   `claim_pending_collection_run` → `submit_collection_result` / `submit_collection_failure`.
 */
import { runCollection, type TickRpc } from '@juriflow/collector-engine';
import type { ProcessDataSource, SourceTarget } from '@juriflow/collectors-core';
import type { CategoryResolver, KnownMovement } from '@juriflow/movement-normalizer';

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

export interface DataJudBatchDeps {
  readonly rpc: TickRpc;
  /** Fonte já configurada (normalmente um `DataJudAdapter`). */
  readonly source: ProcessDataSource;
  readonly resolveCategory: CategoryResolver;
  /** Máximo de execuções por lote. Default: 20. */
  readonly maxRuns?: number;
  /** Espaçamento entre requisições, em ms. Default: 600 (~100 req/min). */
  readonly spacingMs?: number;
  /** `sleep` injetável (testes). Default: `setTimeout`. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface DataJudBatchOutcome {
  readonly processed: number;
  readonly failed: number;
  /** Execuções concluídas com sucesso e zero movimentos (processo ausente no DataJud). */
  readonly empty: number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function runDataJudBatch(deps: DataJudBatchDeps): Promise<DataJudBatchOutcome> {
  const maxRuns = deps.maxRuns ?? 20;
  const spacingMs = deps.spacingMs ?? 600;
  const sleep = deps.sleep ?? defaultSleep;

  let processed = 0;
  let failed = 0;
  let empty = 0;

  for (let i = 0; i < maxRuns; i++) {
    // Espaça as chamadas ao DataJud sem manter uma run reclamada durante o sleep:
    // a pausa fica entre o `submit` da run anterior e o `claim` da próxima.
    if (i > 0 && spacingMs > 0) await sleep(spacingMs);

    const claim = await deps.rpc.rpc('claim_pending_collection_run');
    if (claim.error) throw new Error(`claim_pending_collection_run: ${claim.error.message}`);
    if (claim.data == null) break;

    const c = claim.data as ClaimData;
    const target: SourceTarget = {
      cnjNumber: c.cnj_number,
      courtId: c.court_id,
      params: c.source_params,
    };
    const known: KnownMovement[] = c.known.map((k) => ({
      contentHash: k.content_hash,
      sourceMovementId: k.source_movement_id,
    }));

    const outcome = await runCollection({
      source: deps.source,
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
      continue;
    }

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
    if (outcome.movements.length === 0) empty++;
  }

  return { processed, failed, empty };
}
