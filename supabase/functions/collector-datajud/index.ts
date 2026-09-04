/**
 * Edge Function `collector-datajud` — runtime da Acompanhamento-B.
 *
 * Acionada por pg_cron + pg_net a cada ~5 min (migration 0023). Executa um lote
 * curto de coletas DataJud reusando `claim_pending_collection_run` e as RPCs de
 * submissão da Acompanhamento-A. Toda a lógica testável está em `handler.ts`.
 *
 * Secrets exigidos no ambiente da função (nunca em código/migration/banco/logs):
 *   - SUPABASE_URL                (injetado pela plataforma)
 *   - SUPABASE_SERVICE_ROLE_KEY   (secret)
 *   - DATAJUD_API_KEY             (secret)
 *   - COLLECTOR_INVOKE_SECRET     (secret; OBRIGATÓRIO — sem ele a função responde
 *                                  503 e não processa nada, em qualquer ambiente)
 */
import { createClient } from '@supabase/supabase-js';
import { handle, type SupabaseLike } from './handler.ts';

Deno.serve((req: Request): Promise<Response> =>
  handle(req, {
    getEnv: (name) => Deno.env.get(name),
    createClient: (url, serviceRoleKey) =>
      createClient(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }) as unknown as SupabaseLike,
    logger: (level, message, ctx) => {
      const line = ctx ? `${message} ${JSON.stringify(ctx)}` : message;
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    },
  }),
);
