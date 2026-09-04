import { describe, expect, it } from 'vitest';
import { SourceRegistry } from '@juriflow/collectors-core';
import type { CategoryResolver } from '@juriflow/movement-normalizer';
import { runCollectorTick, type TickRpc } from './tick.js';
import { MockSourceAdapter, rawMovement } from './testing/mock-source-adapter.js';

const resolveCategory: CategoryResolver = () => null;

function fakeRpc(claims: unknown[]): { rpc: TickRpc; calls: { fn: string; args?: Record<string, unknown> }[] } {
  const queue = [...claims];
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  const rpc: TickRpc = {
    async rpc(fn, args) {
      calls.push({ fn, ...(args ? { args } : {}) });
      if (fn === 'claim_pending_collection_run') {
        return { data: queue.length ? queue.shift() : null, error: null };
      }
      return { data: null, error: null };
    },
  };
  return { rpc, calls };
}

const claim = {
  run_id: 'run-1',
  process_id: 'p-1',
  space_id: 's-1',
  source_kind: 'datajud',
  trigger: 'manual',
  attempt: 1,
  cnj_number: '0000001-23.2024.8.04.0001',
  court_id: 'court-1',
  source_params: {},
  is_first_sync: true,
  since: null,
  state_hash_before: null,
  known: [],
};

describe('runCollectorTick', () => {
  it('reclama, roda o motor e envia submit_collection_result', async () => {
    const registry = new SourceRegistry();
    registry.register('datajud', () => new MockSourceAdapter({
      pages: [[rawMovement({ description: 'Distribuído', occurredAt: '2024-01-01T00:00:00Z', sourceMovementId: 'S1' })]],
    }));

    const { rpc, calls } = fakeRpc([claim]);
    const out = await runCollectorTick({ rpc, registry, resolveCategory });

    expect(out).toEqual({ processed: 1, failed: 0 });
    const submit = calls.find((c) => c.fn === 'submit_collection_result');
    expect(submit).toBeDefined();
    const result = submit!.args!['p_result'] as Record<string, unknown>;
    expect(result['status']).toBe('success');
    expect(result['first_sync_completed']).toBe(true);
    expect((result['movements'] as unknown[]).length).toBe(1);
  });

  it('envia submit_collection_failure quando a fonte falha', async () => {
    const registry = new SourceRegistry();
    registry.register('datajud', () => new MockSourceAdapter({ failWith: 'timeout' }));

    const { rpc, calls } = fakeRpc([claim]);
    const out = await runCollectorTick({ rpc, registry, resolveCategory });

    expect(out).toEqual({ processed: 0, failed: 1 });
    const fail = calls.find((c) => c.fn === 'submit_collection_failure');
    expect((fail!.args!['p_error'] as Record<string, unknown>)['error_code']).toBe('timeout');
    expect((fail!.args!['p_error'] as Record<string, unknown>)['retriable']).toBe(true);
  });

  it('para quando não há mais execuções pendentes', async () => {
    const registry = new SourceRegistry();
    const { rpc } = fakeRpc([]);
    const out = await runCollectorTick({ rpc, registry, resolveCategory });
    expect(out).toEqual({ processed: 0, failed: 0 });
  });
});
