import { SourceRegistry } from '@juriflow/collectors-core';
import { runCollectorTick, type TickRpc } from '@juriflow/collector-engine';
import type { CategoryResolver } from '@juriflow/movement-normalizer';
import { describe, expect, it } from 'vitest';

import { PlaywrightCollector } from './playwright-collector.js';
import { registerTjamProjudiSource } from './source-registry.js';
import { FakeBrowserCaseRunner, fakeMovement } from './testing/index.js';

const resolveCategory: CategoryResolver = () => null;

type Call = { fn: string; args?: Record<string, unknown> };

/** RPC falso: serve `claim_pending_collection_run` de uma fila e grava as chamadas. */
function fakeRpc(claims: unknown[]): { rpc: TickRpc; calls: Call[] } {
  const queue = [...claims];
  const calls: Call[] = [];
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

const baseClaim = {
  run_id: 'run-1',
  process_id: 'p-1',
  space_id: 's-1',
  source_kind: 'projudi_tjam',
  trigger: 'manual',
  attempt: 1,
  cnj_number: '0280181-52.2025.8.04.1000',
  court_id: 'court-tjam',
  source_params: {},
  is_first_sync: true,
  since: null,
  state_hash_before: null,
  known: [] as { content_hash: string; source_movement_id: string | null }[],
};

const submitResult = (calls: Call[]): Record<string, unknown> =>
  calls.find((c) => c.fn === 'submit_collection_result')?.args?.['p_result'] as Record<string, unknown>;
const submitFailure = (calls: Call[]): Record<string, unknown> =>
  calls.find((c) => c.fn === 'submit_collection_failure')?.args?.['p_error'] as Record<string, unknown>;

describe('registerTjamProjudiSource', () => {
  it('registra a fonte projudi_tjam com um PlaywrightCollector que trata alvos com CNJ', () => {
    const registry = registerTjamProjudiSource(new SourceRegistry(), {
      runner: new FakeBrowserCaseRunner(),
    });

    expect(registry.has('projudi_tjam')).toBe(true);
    const source = registry.create('projudi_tjam');
    expect(source).toBeInstanceOf(PlaywrightCollector);
    expect(source.kind).toBe('projudi_tjam');
    expect(source.canHandle({ cnjNumber: '0280181-52.2025.8.04.1000', courtId: 'court-tjam' })).toBe(true);
    expect(source.canHandle({ cnjNumber: null, courtId: 'court-tjam' })).toBe(false);
  });

  it('respeita um source_kind customizado', () => {
    const registry = registerTjamProjudiSource(new SourceRegistry(), {
      kind: 'projudi_tjam_beta',
      runner: new FakeBrowserCaseRunner(),
    });
    expect(registry.has('projudi_tjam_beta')).toBe(true);
    expect(registry.create('projudi_tjam_beta').kind).toBe('projudi_tjam_beta');
  });

  it('encaixa no runCollectorTick: claim -> coleta (runner fake) -> submit_collection_result', async () => {
    const registry = registerTjamProjudiSource(new SourceRegistry(), {
      runner: new FakeBrowserCaseRunner({
        outcome: {
          status: 'found',
          movements: [
            fakeMovement({ sourceMovementId: '69', occurredAt: '2026-09-03T15:51:37.000Z', description: 'EXPEDIÇÃO DE INTIMAÇÃO' }),
            fakeMovement({ sourceMovementId: '68', occurredAt: '2026-09-01T04:45:23.000Z', description: 'CONCLUSÃO' }),
          ],
        },
      }),
    });

    const { rpc, calls } = fakeRpc([{ ...baseClaim }]);
    const out = await runCollectorTick({ rpc, registry, resolveCategory });

    expect(out).toEqual({ processed: 1, failed: 0 });
    const result = submitResult(calls);
    expect(result['status']).toBe('success');
    expect(result['first_sync_completed']).toBe(true);
    const movements = result['movements'] as Record<string, unknown>[];
    expect(movements).toHaveLength(2);
    for (const m of movements) {
      expect(m['content_hash']).toMatch(/^[0-9a-f]{64}$/);
      expect(m['is_first_sync']).toBe(true);
    }
    expect(result['state_hash']).toMatch(/^[0-9a-f]{64}$/);
    // nenhum nome de pessoa (coluna "Movimentado por" nunca é coletada)
    expect(JSON.stringify(result)).not.toMatch(/Movimentado por/i);
  });

  it('detecta movimentação nova numa segunda coleta (known preenchido)', async () => {
    const runnerFirst = new FakeBrowserCaseRunner({
      outcome: {
        status: 'found',
        movements: [fakeMovement({ sourceMovementId: '1', occurredAt: '2025-10-12T07:40:12.000Z', description: 'JUNTADA DE PETIÇÃO DE INICIAL' })],
      },
    });
    const first = fakeRpc([{ ...baseClaim, run_id: 'run-a' }]);
    await runCollectorTick({
      rpc: first.rpc,
      registry: registerTjamProjudiSource(new SourceRegistry(), { runner: runnerFirst }),
      resolveCategory,
    });
    const known = (submitResult(first.calls)['movements'] as Record<string, unknown>[]).map((m) => ({
      content_hash: m['content_hash'] as string,
      source_movement_id: (m['source_movement_id'] as string) ?? null,
    }));

    // segunda coleta: a mesma movimentação + uma nova (seq 2)
    const runnerSecond = new FakeBrowserCaseRunner({
      outcome: {
        status: 'found',
        movements: [
          fakeMovement({ sourceMovementId: '1', occurredAt: '2025-10-12T07:40:12.000Z', description: 'JUNTADA DE PETIÇÃO DE INICIAL' }),
          fakeMovement({ sourceMovementId: '2', occurredAt: '2025-10-13T12:00:00.000Z', description: 'CONCLUSÃO PARA DESPACHO' }),
        ],
      },
    });
    const second = fakeRpc([
      { ...baseClaim, run_id: 'run-b', is_first_sync: false, known, state_hash_before: submitResult(first.calls)['state_hash'] },
    ]);
    await runCollectorTick({
      rpc: second.rpc,
      registry: registerTjamProjudiSource(new SourceRegistry(), { runner: runnerSecond }),
      resolveCategory,
    });

    const result = submitResult(second.calls);
    expect((result['counts'] as Record<string, number>)['new']).toBe(1);
    const events = result['events'] as Record<string, unknown>[];
    expect(events.some((e) => e['event_type'] === 'new_movement')).toBe(true);
  });

  it('processo inexistente na fonte -> submit_collection_failure com error_code not_found', async () => {
    const registry = registerTjamProjudiSource(new SourceRegistry(), {
      runner: new FakeBrowserCaseRunner({ outcome: { status: 'not_found' } }),
    });
    const { rpc, calls } = fakeRpc([{ ...baseClaim }]);
    const out = await runCollectorTick({ rpc, registry, resolveCategory });

    expect(out).toEqual({ processed: 0, failed: 1 });
    const err = submitFailure(calls);
    expect(err['error_code']).toBe('not_found');
    expect(err['retriable']).toBe(false);
  });
});
