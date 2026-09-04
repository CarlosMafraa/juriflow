/**
 * Núcleo (testável) do runtime DataJud da Acompanhamento-B.
 *
 * Fluxo, reusando integralmente a Acompanhamento-A:
 *   HTTP call → valida segredos/config → `claim_pending_collection_run()`
 *   → `DataJudAdapter.fetch()` → `runCollection()` (motor não alterado)
 *   → `submit_collection_result()` / `submit_collection_failure()`.
 *
 * NÃO é o `collector-worker` (Acompanhamento-C): é um lote curto acionado por
 * pg_cron/pg_net a cada ~5 min. Sem navegador, sem scraping, sem Vault.
 *
 * Segredos (`DATAJUD_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `COLLECTOR_INVOKE_SECRET`)
 * vêm SEMPRE do ambiente da Edge Function. Nunca são logados nem devolvidos.
 */
import {
  DataJudAdapter,
  runDataJudBatch,
  type DataJudStrategy,
  type DataJudStrategyResolver,
  type FetchLike,
} from '@juriflow/adapter-datajud';
import { CollectionError, type TickRpc } from '@juriflow/collector-engine';
import type { CategoryResolver } from '@juriflow/movement-normalizer';

const SOURCE_KIND = 'datajud';

type QueryResult<T> = Promise<{ data: T; error: { message: string } | null }>;

/** Builder mínimo compatível com o `PostgrestFilterBuilder` do supabase-js (thenable + `.eq`). */
export interface QueryBuilder<T> extends PromiseLike<{
  data: T;
  error: { message: string } | null;
}> {
  eq(column: string, value: unknown): QueryBuilder<T>;
  maybeSingle(): QueryResult<T extends readonly (infer E)[] ? E | null : T | null>;
}

/** Subconjunto do cliente `@supabase/supabase-js` que usamos aqui. */
export interface SupabaseLike extends TickRpc {
  from(table: string): { select(columns: string): QueryBuilder<Record<string, unknown>[]> };
}

export interface HandlerDeps {
  getEnv(name: string): string | undefined;
  createClient(url: string, serviceRoleKey: string): SupabaseLike;
  /** `fetch` injetável para o adapter (testes). Default: `globalThis.fetch`. */
  fetchFn?: FetchLike;
  /** Log estruturado. Nunca recebe segredos. */
  logger?: (
    level: 'info' | 'warn' | 'error',
    message: string,
    ctx?: Record<string, unknown>,
  ) => void;
  batchSize?: number;
  spacingMs?: number;
}

export function buildCategoryResolver(
  rows: readonly { code: string; label: string }[],
): CategoryResolver {
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const byLabel = new Map(rows.map((r) => [r.label.toLowerCase(), r]));
  return ({ code, label }) => {
    const hit =
      (code ? byCode.get(code) : undefined) ??
      (label ? byLabel.get(String(label).toLowerCase()) : undefined);
    return hit ? { code: hit.code, label: hit.label } : null;
  };
}

/** Resolve a estratégia DataJud do tribunal a partir de `court_tracking_strategies`. */
export function buildStrategyResolver(supabase: SupabaseLike): DataJudStrategyResolver {
  const cache = new Map<string, DataJudStrategy>();
  return async (courtId: string): Promise<DataJudStrategy> => {
    const cached = cache.get(courtId);
    if (cached) return cached;

    const { data, error } = await supabase
      .from('court_tracking_strategies')
      .select('params, enabled')
      .eq('court_id', courtId)
      .eq('source_kind', SOURCE_KIND)
      .maybeSingle();

    if (error) {
      throw new CollectionError(
        'unknown',
        `Falha ao ler a estratégia do tribunal: ${error.message}`,
        false,
      );
    }
    const row = data as { params?: Record<string, unknown>; enabled?: boolean } | null;
    if (!row || row.enabled === false) {
      throw new CollectionError(
        'unknown',
        `Sem estratégia DataJud habilitada para o tribunal ${courtId}.`,
        false,
      );
    }
    const params = row.params ?? {};
    const alias = typeof params['alias'] === 'string' ? (params['alias'] as string) : '';
    if (!alias) {
      throw new CollectionError(
        'unknown',
        `Estratégia DataJud do tribunal ${courtId} sem "alias".`,
        false,
      );
    }
    cache.set(courtId, {
      alias,
      timeoutMs:
        typeof params['timeout_ms'] === 'number' ? (params['timeout_ms'] as number) : undefined,
      maxMovements:
        typeof params['max_movements'] === 'number'
          ? (params['max_movements'] as number)
          : undefined,
    });
    return cache.get(courtId)!;
  };
}

export interface CollectorOutcome {
  processed: number;
  failed: number;
  empty: number;
}

/** Executa um lote: carrega taxonomia, monta o adapter e roda `runDataJudBatch`. */
export async function runDataJudCollector(args: {
  supabase: SupabaseLike;
  apiKey: string;
  fetchFn?: FetchLike;
  logger?: HandlerDeps['logger'];
  batchSize?: number;
  spacingMs?: number;
}): Promise<CollectorOutcome> {
  const taxonomy = await args.supabase.from('movement_categories').select('code, label');
  if (taxonomy.error) {
    throw new Error(`movement_categories: ${taxonomy.error.message}`);
  }
  const rows = (taxonomy.data as { code: string; label: string }[]) ?? [];
  const resolveCategory = buildCategoryResolver(rows);

  const adapter = new DataJudAdapter({
    apiKey: args.apiKey,
    resolveStrategy: buildStrategyResolver(args.supabase),
    fetchFn: args.fetchFn,
    logger: (level, message, ctx) => args.logger?.(level, `[datajud] ${message}`, ctx),
  });

  return runDataJudBatch({
    rpc: args.supabase,
    source: adapter,
    resolveCategory,
    maxRuns: args.batchSize ?? 20,
    spacingMs: args.spacingMs ?? 600,
  });
}

/** Ponto de entrada HTTP. Faz auth por segredo compartilhado e valida o ambiente. */
export async function handle(req: Request, deps: HandlerDeps): Promise<Response> {
  const log = deps.logger ?? ((): void => undefined);
  const json = (status: number, body: Record<string, unknown>): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  // Fail closed EM QUALQUER AMBIENTE: sem o segredo compartilhado a função não
  // processa nada. `verify_jwt = false` no gateway ⇒ este é o único gate.
  const invokeSecret = deps.getEnv('COLLECTOR_INVOKE_SECRET');
  if (!invokeSecret) {
    log('error', 'COLLECTOR_INVOKE_SECRET não configurado — a função recusa toda invocação.');
    return json(503, { error: 'collector_invoke_secret_not_configured' });
  }
  if ((req.headers.get('authorization') ?? '') !== `Bearer ${invokeSecret}`) {
    return json(401, { error: 'unauthorized' });
  }

  const supabaseUrl = deps.getEnv('SUPABASE_URL');
  const serviceRoleKey = deps.getEnv('SUPABASE_SERVICE_ROLE_KEY');
  const apiKey = deps.getEnv('DATAJUD_API_KEY');
  const missing = [
    !supabaseUrl && 'SUPABASE_URL',
    !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
    !apiKey && 'DATAJUD_API_KEY',
  ].filter(Boolean) as string[];
  if (missing.length > 0) {
    log('error', 'Segredos/variáveis ausentes no ambiente da função.', { missing });
    return json(500, { error: 'missing_configuration', missing });
  }

  try {
    const supabase = deps.createClient(supabaseUrl!, serviceRoleKey!);
    const outcome = await runDataJudCollector({
      supabase,
      apiKey: apiKey!,
      fetchFn: deps.fetchFn,
      logger: deps.logger,
      batchSize: deps.batchSize,
      spacingMs: deps.spacingMs,
    });
    log('info', 'Lote DataJud concluído.', { ...outcome });
    return json(200, { ok: true, ...outcome });
  } catch (err) {
    log('error', 'Falha no lote DataJud.', { message: (err as Error)?.message ?? String(err) });
    return json(500, { error: 'batch_failed' });
  }
}
