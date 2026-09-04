/**
 * Testes do handler da Edge Function `collector-datajud`.
 *
 * Executar com:  deno test --allow-env supabase/functions/collector-datajud/index.test.ts
 * Requer os pacotes compilados em `packages/<x>/dist` (npm run build) e Deno instalado.
 * NÃO faz chamadas reais ao DataJud — o `fetch` é sempre injetado.
 */
import { assertEquals } from 'jsr:@std/assert@1';
import { handle, type HandlerDeps, type SupabaseLike } from './handler.ts';

const INVOKE_SECRET = 'invoke-secret-not-real';
const ENV: Record<string, string> = {
  SUPABASE_URL: 'http://localhost:55321',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-not-real',
  DATAJUD_API_KEY: 'datajud-key-not-real',
  COLLECTOR_INVOKE_SECRET: INVOKE_SECRET,
};

const ENVELOPE_ONE_HIT = {
  hits: {
    total: { value: 1 },
    hits: [
      {
        _source: {
          numeroProcesso: '00008325020238040001',
          tribunal: 'TJXX',
          movimentos: [{ codigo: 26, nome: 'Distribuição', dataHora: '2024-01-02T10:00:00.000Z' }],
        },
      },
    ],
  },
};

/** POST autenticado com o Bearer correto (caminho normal). */
function authedPost(): Request {
  return new Request('http://x', {
    method: 'POST',
    headers: { authorization: `Bearer ${INVOKE_SECRET}` },
  });
}

function fakeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Cliente Supabase falso: taxonomia + estratégia + fila de claims + captura de submits. */
function fakeSupabase(opts: {
  claims: (Record<string, unknown> | null)[];
  submits: { fn: string; args?: Record<string, unknown> }[];
}): SupabaseLike {
  const queue = [...opts.claims];
  return {
    async rpc(fn: string, args?: Record<string, unknown>) {
      if (fn === 'claim_pending_collection_run') {
        return { data: queue.length ? queue.shift()! : null, error: null };
      }
      opts.submits.push({ fn, args });
      return { data: null, error: null };
    },
    from(table: string) {
      return {
        select() {
          const builder = {
            _eq: {} as Record<string, unknown>,
            eq(col: string, val: unknown) {
              this._eq[col] = val;
              return this;
            },
            async maybeSingle() {
              if (table === 'court_tracking_strategies') {
                return {
                  data: {
                    params: { alias: 'api_publica_tjxx', max_movements: 5000 },
                    enabled: true,
                  },
                  error: null,
                };
              }
              return { data: null, error: null };
            },
            then(resolve: (v: { data: unknown; error: null }) => unknown) {
              if (table === 'movement_categories') {
                return resolve({ data: [{ code: '26', label: 'Distribuição' }], error: null });
              }
              return resolve({ data: [], error: null });
            },
          };
          return builder as unknown as ReturnType<ReturnType<SupabaseLike['from']>['select']>;
        },
      };
    },
  };
}

function baseDeps(over: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    getEnv: (k) => ENV[k],
    createClient: () => fakeSupabase({ claims: [], submits: [] }),
    fetchFn: (async () => fakeResponse(200, ENVELOPE_ONE_HIT)) as HandlerDeps['fetchFn'],
    ...over,
  };
}

Deno.test('rejeita método diferente de POST', async () => {
  const res = await handle(new Request('http://x', { method: 'GET' }), baseDeps());
  assertEquals(res.status, 405);
});

Deno.test('fail closed: 503 quando COLLECTOR_INVOKE_SECRET não está configurado', async () => {
  const res = await handle(
    authedPost(),
    baseDeps({ getEnv: (k) => (k === 'COLLECTOR_INVOKE_SECRET' ? undefined : ENV[k]) }),
  );
  assertEquals(res.status, 503);
  assertEquals((await res.json()).error, 'collector_invoke_secret_not_configured');
});

Deno.test('401 quando o Bearer não confere', async () => {
  const res = await handle(new Request('http://x', { method: 'POST' }), baseDeps());
  assertEquals(res.status, 401);
});

Deno.test('500 quando um segredo obrigatório está ausente', async () => {
  const res = await handle(
    authedPost(),
    baseDeps({ getEnv: (k) => ({ ...ENV, DATAJUD_API_KEY: '' })[k] || undefined }),
  );
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, 'missing_configuration');
});

Deno.test('claim → fetch → submit_collection_result no caminho feliz', async () => {
  const submits: { fn: string; args?: Record<string, unknown> }[] = [];
  const supabase = fakeSupabase({
    claims: [
      {
        run_id: 'r1',
        process_id: 'p1',
        space_id: 's1',
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
      },
      null,
    ],
    submits,
  });
  const res = await handle(authedPost(), baseDeps({ createClient: () => supabase, spacingMs: 0 }));
  assertEquals(res.status, 200);
  assertEquals(
    submits.map((s) => s.fn),
    ['submit_collection_result'],
  );
  assertEquals(submits[0].args?.p_run_id, 'r1');
});

Deno.test('erro do adapter vira submit_collection_failure', async () => {
  const submits: { fn: string; args?: Record<string, unknown> }[] = [];
  const supabase = fakeSupabase({
    claims: [
      {
        run_id: 'r9',
        process_id: 'p9',
        space_id: 's1',
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
      },
      null,
    ],
    submits,
  });
  const res = await handle(
    authedPost(),
    baseDeps({
      createClient: () => supabase,
      spacingMs: 0,
      fetchFn: (async () => fakeResponse(503, {})) as HandlerDeps['fetchFn'],
    }),
  );
  assertEquals(res.status, 200);
  assertEquals(
    submits.map((s) => s.fn),
    ['submit_collection_failure'],
  );
  assertEquals((submits[0].args?.p_error as Record<string, unknown>).error_code, 'unavailable');
});
