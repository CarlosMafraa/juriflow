import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SourceRegistry } from '@juriflow/collectors-core';
import { runCollectorTick, type TickRpc } from '@juriflow/collector-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerTjamProjudiSource } from './source-registry.js';

/**
 * TESTE PONTA-A-PONTA REAL (Etapa 11) — Supabase local + Playwright + Microsoft
 * Edge + PROJUDI Consulta Pública do TJAM.
 *
 * Prova o caminho completo do MVP:
 *   seed -> collection_runs 'pending' -> runCollectorTick -> Edge abre -> PROJUDI
 *   -> movimentações -> submit_collection_result -> linhas persistidas em
 *   process_movements / process_tracking_state / process_change_events /
 *   collection_raw_payloads. Uma segunda coleta prova a deduplicação e o
 *   detector reportando "nada novo".
 *
 * Só roda com:
 *   JURIFLOW_TEST_PROJUDI_E2E=1
 *   SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=...   (veja `npx supabase status`)
 *
 *   JURIFLOW_TEST_PROJUDI_E2E=1 SUPABASE_URL=http://127.0.0.1:55321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<key> \
 *   npx vitest run packages/adapter-playwright/src/projudi-e2e.integration.spec.ts
 */
const E2E = process.env['JURIFLOW_TEST_PROJUDI_E2E'] === '1';
const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:55321';
const SERVICE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';
const CNJ = process.env['JURIFLOW_TEST_PROJUDI_CNJ'] ?? '0280181-52.2025.8.04.1000';
const EDGE_PROFILE = fileURLToPath(new URL('../../../.cache/projudi-edge-it-profile', import.meta.url));

interface Seed {
  userId: string;
  spaceId: string;
  courtId: string;
  processId: string;
  configId: string;
}

/** Adapta o SupabaseClient à interface mínima esperada pelo runCollectorTick. */
function asTickRpc(client: SupabaseClient): TickRpc {
  return {
    rpc: async (fn, args) => {
      const { data, error } = await client.rpc(fn, args);
      return { data, error: error ? { message: error.message } : null };
    },
  };
}

async function seed(admin: SupabaseClient): Promise<Seed> {
  const tag = randomUUID().slice(0, 8);
  const spaceId = randomUUID();
  const courtId = randomUUID();
  const processId = randomUUID();
  const configId = randomUUID();

  const created = await admin.auth.admin.createUser({
    email: `e2e-${tag}@juriflow.test`,
    password: randomUUID(),
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error(`createUser: ${created.error?.message ?? 'sem usuário'}`);
  }
  const userId = created.data.user.id;

  const steps: { label: string; error: { message: string } | null }[] = [
    { label: 'spaces', error: (await admin.from('spaces').insert({ id: spaceId, name: `E2E ${tag}`, slug: `e2e-${tag}` })).error },
    {
      label: 'space_members',
      error: (await admin.from('space_members').insert({ space_id: spaceId, profile_id: userId, role: 'ADMIN', status: 'active' })).error,
    },
    {
      label: 'courts',
      error: (await admin.from('courts').insert({ id: courtId, name: `TJAM E2E ${tag}`, type: 'TJ', jurisdiction: 'AM', active: true })).error,
    },
    {
      label: 'court_tracking_strategies',
      error: (
        await admin
          .from('court_tracking_strategies')
          .insert({ court_id: courtId, source_kind: 'projudi_tjam', requires_cnj: true, enabled: true })
      ).error,
    },
    {
      label: 'processes',
      error: (
        await admin.from('processes').insert({
          id: processId,
          space_id: spaceId,
          court_id: courtId,
          assigned_user_id: userId,
          created_by: userId,
          cnj_number: CNJ,
          status: 'active',
        })
      ).error,
    },
    {
      label: 'process_tracking_configs',
      error: (
        await admin
          .from('process_tracking_configs')
          .insert({ id: configId, process_id: processId, source_kind: 'projudi_tjam', enabled: true, created_by: userId })
      ).error,
    },
  ];
  for (const s of steps) {
    if (s.error) throw new Error(`seed ${s.label}: ${s.error.message}`);
  }
  return { userId, spaceId, courtId, processId, configId };
}

async function cleanup(admin: SupabaseClient, s: Seed): Promise<void> {
  // spaces cascateia processos/configs/runs/movimentações/eventos/estado/payloads.
  await admin.from('spaces').delete().eq('id', s.spaceId);
  await admin.from('court_tracking_strategies').delete().eq('court_id', s.courtId);
  await admin.from('courts').delete().eq('id', s.courtId);
  await admin.auth.admin.deleteUser(s.userId);
}

/** Enfileira uma collection_run 'pending' e devolve o id. */
async function queueRun(admin: SupabaseClient, s: Seed): Promise<string> {
  const { data, error } = await admin
    .from('collection_runs')
    .insert({
      process_id: s.processId,
      tracking_config_id: s.configId,
      source_kind: 'projudi_tjam',
      trigger: 'manual',
      status: 'pending',
      attempt: 1,
    })
    .select('id')
    .single();
  if (error) throw new Error(`queueRun: ${error.message}`);
  return (data as { id: string }).id;
}

function makeRegistry(): SourceRegistry {
  return registerTjamProjudiSource(new SourceRegistry(), {
    runnerOptions: { headless: false, timeoutMs: 120_000, userDataDir: EDGE_PROFILE },
  });
}

describe.skipIf(!E2E || !SERVICE_KEY)('PROJUDI/TJAM E2E — Supabase local + Edge + persistência', () => {
  let admin: SupabaseClient;
  let s: Seed;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    s = await seed(admin);
  }, 60_000);

  afterAll(async () => {
    if (admin && s) await cleanup(admin, s);
  }, 60_000);

  it(
    'primeira coleta real: grava movimentações, estado e evento de 1ª sincronização',
    async () => {
      const runId = await queueRun(admin, s);
      const out = await runCollectorTick({ rpc: asTickRpc(admin), registry: makeRegistry(), resolveCategory: () => null });
      expect(out).toEqual({ processed: 1, failed: 0 });

      const { data: run } = await admin.from('collection_runs').select('*').eq('id', runId).single();
      expect(run?.['status']).toBe('success');
      expect(run?.['movements_fetched']).toBeGreaterThanOrEqual(1);
      expect(run?.['movements_new']).toBeGreaterThanOrEqual(1);
      expect(run?.['state_hash_after']).toMatch(/^[0-9a-f]{64}$/);

      const { data: movements } = await admin.from('process_movements').select('*').eq('process_id', s.processId);
      expect((movements ?? []).length).toBeGreaterThanOrEqual(1);
      for (const m of movements ?? []) {
        expect(m['content_hash']).toMatch(/^[0-9a-f]{64}$/);
        expect(m['source_kind']).toBe('projudi_tjam');
        expect(m['is_first_sync']).toBe(true);
        expect(m['raw']).toBeTruthy();
      }
      // Seq do PROJUDI vira o id estável da movimentação.
      expect((movements ?? []).some((m) => /^\d+$/.test(String(m['source_movement_id'] ?? '')))).toBe(true);
      // A coluna "Movimentado por" (nomes de pessoas) nunca é persistida.
      expect(JSON.stringify(movements)).not.toMatch(/Movimentado por/i);

      const { data: state } = await admin
        .from('process_tracking_state')
        .select('*')
        .eq('process_id', s.processId)
        .single();
      expect(state?.['first_sync_done']).toBe(true);
      expect(state?.['state_hash']).toMatch(/^[0-9a-f]{64}$/);
      expect(state?.['last_movement_occurred_at']).toBeTruthy();

      const { data: events } = await admin.from('process_change_events').select('*').eq('process_id', s.processId);
      expect((events ?? []).some((e) => e['event_type'] === 'first_sync_completed')).toBe(true);

      const { data: payloads } = await admin
        .from('collection_raw_payloads')
        .select('id')
        .eq('collection_run_id', runId);
      expect((payloads ?? []).length).toBe(1);

      const sorted = [...(movements ?? [])].sort(
        (a, b) => Number(a['source_movement_id'] ?? 0) - Number(b['source_movement_id'] ?? 0),
      );
      console.error(
        `[E2E PROJUDI] run=${runId} status=${run?.['status']} ` +
          `fetched=${run?.['movements_fetched']} new=${run?.['movements_new']}; ` +
          `process_movements=${(movements ?? []).length}; primeira:`,
        JSON.stringify({
          source_movement_id: sorted[0]?.['source_movement_id'],
          occurred_at: sorted[0]?.['occurred_at'],
          description: sorted[0]?.['description'],
          content_hash: sorted[0]?.['content_hash'],
        }),
      );
    },
    240_000,
  );

  it(
    'segunda coleta real: deduplica e o detector reporta zero movimentações novas',
    async () => {
      const { count: mvBefore } = await admin
        .from('process_movements')
        .select('*', { count: 'exact', head: true })
        .eq('process_id', s.processId);
      const { count: evBefore } = await admin
        .from('process_change_events')
        .select('*', { count: 'exact', head: true })
        .eq('process_id', s.processId);

      const runId = await queueRun(admin, s);
      const out = await runCollectorTick({ rpc: asTickRpc(admin), registry: makeRegistry(), resolveCategory: () => null });
      expect(out).toEqual({ processed: 1, failed: 0 });

      const { data: run } = await admin.from('collection_runs').select('*').eq('id', runId).single();
      expect(run?.['status']).toBe('success');
      expect(run?.['movements_new']).toBe(0);

      const { count: mvAfter } = await admin
        .from('process_movements')
        .select('*', { count: 'exact', head: true })
        .eq('process_id', s.processId);
      const { count: evAfter } = await admin
        .from('process_change_events')
        .select('*', { count: 'exact', head: true })
        .eq('process_id', s.processId);

      expect(mvAfter).toBe(mvBefore);
      expect(evAfter).toBe(evBefore);
    },
    240_000,
  );
});
