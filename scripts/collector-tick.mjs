/**
 * JuriFlow — tick de coleta da Acompanhamento-A (utilitário de desenvolvimento).
 *
 * NÃO é o worker de produção (Acompanhamento-C). Reclama execuções pendentes,
 * roda o motor contra o MockSourceAdapter (nenhuma fonte real) e envia o
 * resultado. Use após `collect_process_now` / `app.tracking_sweep()`.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/collector-tick.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { SourceRegistry } from '@juriflow/collectors-core';
import { runCollectorTick } from '@juriflow/collector-engine';
import { MockSourceAdapter } from '@juriflow/collector-engine/testing';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:55321';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) {
  console.error('Defina SUPABASE_SERVICE_ROLE_KEY (veja `npx supabase status`).');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

// Cenário de demonstração — determinístico. Nenhuma chamada externa.
const demoPages = [
  [
    {
      sourceKind: 'datajud',
      sourceMovementId: 'M1',
      occurredAt: '2024-01-10T12:00:00Z',
      description: 'Distribuído por sorteio',
      raw: { movementCode: '26', movementLabel: 'Distribuição' },
    },
    {
      sourceKind: 'datajud',
      sourceMovementId: 'M2',
      occurredAt: '2024-02-01T09:00:00Z',
      description: 'Juntada de petição inicial',
      raw: { movementCode: '132', movementLabel: 'Juntada' },
    },
  ],
];

const registry = new SourceRegistry();
for (const kind of ['datajud', 'tribunal_api', 'projudi_tjam', 'scraper']) {
  registry.register(kind, () => new MockSourceAdapter({ kind, pages: demoPages, honorSince: true }));
}

// Resolver de categorias a partir de movement_categories.
const { data: cats } = await supabase.from('movement_categories').select('code, label');
const byCode = new Map((cats ?? []).map((c) => [c.code, c]));
const byLabel = new Map((cats ?? []).map((c) => [c.label.toLowerCase(), c]));
const resolveCategory = ({ code, label }) => {
  const hit = (code && byCode.get(code)) || (label && byLabel.get(String(label).toLowerCase()));
  return hit ? { code: hit.code, label: hit.label } : null;
};

const out = await runCollectorTick({ rpc: supabase, registry, resolveCategory });
console.error(`tick concluído: ${out.processed} processada(s), ${out.failed} com falha.`);
