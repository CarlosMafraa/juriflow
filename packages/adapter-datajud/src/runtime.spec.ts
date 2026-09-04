/**
 * `runDataJudBatch` — laço de lote com espaçamento. Reusa as RPCs da
 * Acompanhamento-A: `claim_pending_collection_run` → `submit_collection_result`
 * / `submit_collection_failure`. Não altera o `collector-engine`.
 */
import type { TickRpc } from '@juriflow/collector-engine';
import type { CategoryResolver } from '@juriflow/movement-normalizer';
import { describe, expect, it, vi } from 'vitest';
import { DataJudAdapter } from './datajud-adapter.js';
import { runDataJudBatch } from './runtime.js';
import { envelopeWithMovements, envelopeZeroHits, fakeResponse } from './testing/index.js';

const resolveCategory: CategoryResolver = ({ code }) =>
  code === '26' ? { code: '26', label: 'Distribuição' } : null;

function claimPayload(id: string): Record<string, unknown> {
  return {
    run_id: id,
    process_id: `p-${id}`,
    space_id: 's-1',
    source_kind: 'datajud',
    trigger: 'scheduled',
    attempt: 1,
    cnj_number: '0000832-50.2023.8.04.0001',
    court_id: 'court-1',
    source_params: {},
    is_first_sync: true,
    since: null,
    state_hash_before: null,
    known: [],
  };
}

/** RPC falsa: devolve claims da fila e registra os submits. */
function fakeRpc(claims: (Record<string, unknown> | null)[]): {
  rpc: TickRpc;
  calls: { fn: string; args?: Record<string, unknown> }[];
} {
  const queue = [...claims];
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  const rpc: TickRpc = {
    async rpc(fn, args) {
      calls.push({ fn, args });
      if (fn === 'claim_pending_collection_run') {
        const next = queue.length > 0 ? queue.shift()! : null;
        return { data: next, error: null };
      }
      return { data: null, error: null };
    },
  };
  return { rpc, calls };
}

function adapterFor(body: unknown): DataJudAdapter {
  return new DataJudAdapter({
    apiKey: 'batch-key-not-real',
    resolveStrategy: () => ({ alias: 'api_publica_tjxx' }),
    endpointBase: 'https://datajud.example.test',
    fetchFn: async () => fakeResponse(200, body),
    now: () => new Date('2024-05-01T00:00:00.000Z'),
  });
}

describe('runDataJudBatch', () => {
  it('processa a fila até esvaziar e submete resultado por execução', async () => {
    const { rpc, calls } = fakeRpc([claimPayload('r1'), claimPayload('r2'), null]);
    const sleep = vi.fn(async () => undefined);

    const out = await runDataJudBatch({
      rpc,
      source: adapterFor(envelopeWithMovements),
      resolveCategory,
      spacingMs: 600,
      sleep,
    });

    expect(out).toEqual({ processed: 2, failed: 0, empty: 0 });
    const submits = calls.filter((c) => c.fn === 'submit_collection_result');
    expect(submits).toHaveLength(2);
    expect(submits[0].args?.p_run_id).toBe('r1');
    // Pausa no topo do loop quando i > 0 (nunca antes do 1º claim); a run
    // anterior já foi submetida, então nada fica em `running` durante o sleep.
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(600);
  });

  it('não pausa antes de reclamar a primeira run', async () => {
    const { rpc } = fakeRpc([claimPayload('r1'), null]);
    const order: string[] = [];
    const sleep = vi.fn(async () => {
      order.push('sleep');
    });
    const rpcSpy: typeof rpc = {
      rpc: async (fn, args) => {
        order.push(fn);
        return rpc.rpc(fn, args);
      },
    };

    await runDataJudBatch({
      rpc: rpcSpy,
      source: adapterFor(envelopeWithMovements),
      resolveCategory,
      spacingMs: 600,
      sleep,
    });

    // 1º evento é um claim, não um sleep.
    expect(order[0]).toBe('claim_pending_collection_run');
  });

  it('respeita maxRuns', async () => {
    const { rpc, calls } = fakeRpc([
      claimPayload('r1'),
      claimPayload('r2'),
      claimPayload('r3'),
      null,
    ]);
    const out = await runDataJudBatch({
      rpc,
      source: adapterFor(envelopeWithMovements),
      resolveCategory,
      maxRuns: 1,
      sleep: async () => undefined,
    });
    expect(out.processed).toBe(1);
    expect(calls.filter((c) => c.fn === 'claim_pending_collection_run')).toHaveLength(1);
  });

  it('conta execuções vazias (processo ausente no DataJud) sem marcá-las como falha', async () => {
    const { rpc } = fakeRpc([claimPayload('r1'), null]);
    const out = await runDataJudBatch({
      rpc,
      source: adapterFor(envelopeZeroHits),
      resolveCategory,
      sleep: async () => undefined,
    });
    expect(out).toEqual({ processed: 1, failed: 0, empty: 1 });
  });

  it('encaminha falha classificada para submit_collection_failure', async () => {
    const { rpc, calls } = fakeRpc([claimPayload('r1'), null]);
    const failing = new DataJudAdapter({
      apiKey: 'k',
      resolveStrategy: () => ({ alias: 'a' }),
      endpointBase: 'https://datajud.example.test',
      fetchFn: async () => fakeResponse(503, {}),
    });

    const out = await runDataJudBatch({
      rpc,
      source: failing,
      resolveCategory,
      sleep: async () => undefined,
    });

    expect(out.failed).toBe(1);
    const fail = calls.find((c) => c.fn === 'submit_collection_failure');
    expect(fail?.args?.p_run_id).toBe('r1');
    expect((fail?.args?.p_error as Record<string, unknown>).error_code).toBe('unavailable');
    expect((fail?.args?.p_error as Record<string, unknown>).retriable).toBe(true);
  });
});
