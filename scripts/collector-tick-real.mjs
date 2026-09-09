/**
 * JuriFlow — tick de coleta REAL da Acompanhamento (Etapa 11).
 *
 * Diferente de `collector-tick.mjs` (que usa o MockSourceAdapter), este resolve
 * a fonte `projudi_tjam` para o coletor REAL: Playwright + Microsoft Edge contra
 * a Consulta Pública do PROJUDI/TJAM (Etapas 9 e 10). Reclama as execuções
 * pendentes (`claim_pending_collection_run`), roda o motor e persiste o resultado
 * (`submit_collection_result` / `submit_collection_failure`).
 *
 * Ainda NÃO é o worker de produção: sem loop de longa duração, sem fila
 * distribuída, sem Go. É a cola mínima para provar a persistência ponta-a-ponta.
 *
 * Uso (após `collect_process_now` / `app.tracking_sweep()`):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/collector-tick-real.mjs
 *
 * Variáveis opcionais:
 *   JURIFLOW_TICK_HEADLESS=1        abre o Edge sem janela (o F5/WAF do PROJUDI
 *                                   costuma bloquear — use só para diagnóstico)
 *   JURIFLOW_TICK_TIMEOUT_MS=120000 timeout por passo do navegador
 *   JURIFLOW_EDGE_PROFILE_DIR=...   perfil persistente do Edge (reaproveita a
 *                                   sessão do F5 entre execuções)
 *   JURIFLOW_TICK_MAX=10            máximo de execuções por tick
 */
import { createClient } from '@supabase/supabase-js';
import { SourceRegistry } from '@juriflow/collectors-core';
import { runCollectorTick } from '@juriflow/collector-engine';
import { registerTjamProjudiSource } from '@juriflow/adapter-playwright';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:55321';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) {
  console.error('Defina SUPABASE_SERVICE_ROLE_KEY (veja `npx supabase status`).');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

// Fonte real: projudi_tjam -> PlaywrightCollector + TjamProjudiEdgeRunner (Edge).
const registry = registerTjamProjudiSource(new SourceRegistry(), {
  runnerOptions: {
    headless: process.env.JURIFLOW_TICK_HEADLESS === '1',
    timeoutMs: Number(process.env.JURIFLOW_TICK_TIMEOUT_MS ?? 120_000),
    userDataDir: process.env.JURIFLOW_EDGE_PROFILE_DIR || undefined,
  },
});

// Resolver de categorias a partir de movement_categories (o PROJUDI não traz
// código TPU; normalmente fica sem categoria — o campo é opcional).
const { data: cats, error: catsErr } = await supabase.from('movement_categories').select('code, label');
if (catsErr) {
  console.error(`Falha ao ler movement_categories: ${catsErr.message}`);
  process.exit(1);
}
const byCode = new Map((cats ?? []).map((c) => [c.code, c]));
const byLabel = new Map((cats ?? []).map((c) => [c.label.toLowerCase(), c]));
const resolveCategory = ({ code, label }) => {
  const hit = (code && byCode.get(code)) || (label && byLabel.get(String(label).toLowerCase()));
  return hit ? { code: hit.code, label: hit.label } : null;
};

const out = await runCollectorTick({
  rpc: supabase,
  registry,
  resolveCategory,
  maxRuns: Number(process.env.JURIFLOW_TICK_MAX ?? 10),
});
console.error(`tick real concluído: ${out.processed} processada(s), ${out.failed} com falha.`);
