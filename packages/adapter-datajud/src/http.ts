/**
 * Classificação de falhas HTTP da API Pública do DataJud nas classes de erro
 * já existentes do `@juriflow/collector-engine`. Nenhuma classe nova é criada.
 *
 * Mapeamento (DJ-8, seção 8 do brief):
 *   - abort/timeout do AbortController → CollectionTimeoutError  (timeout, retriável)
 *   - erro de rede / fetch rejeitado   → CollectionUnavailableError (unavailable, retriável)
 *   - HTTP 5xx                          → CollectionUnavailableError (unavailable, retriável)
 *   - HTTP 429                          → CollectionRateLimitedError (rate_limited, retriável);
 *                                        `Retry-After` é lido apenas para LOG (não muda o backoff da A)
 *   - HTTP 401 / 403                    → CollectionAuthError (auth_failed, NÃO retriável)
 *   - JSON inválido / envelope inválido → CollectionParseError (parse_error, NÃO retriável)
 *   - HTTP 200 + zero hits             → NÃO é erro: resultado vazio (tratado no adapter)
 *   - demais 4xx                        → CollectionError('unknown', ..., retriable=false)
 */
import {
  CollectionAuthError,
  CollectionError,
  CollectionRateLimitedError,
  CollectionUnavailableError,
} from '@juriflow/collector-engine';

export interface HttpFailureContext {
  readonly status: number;
  readonly retryAfter?: string | null;
}

export function classifyHttpFailure(ctx: HttpFailureContext): CollectionError {
  const { status } = ctx;

  if (status === 401 || status === 403) {
    return new CollectionAuthError(`DataJud recusou a credencial (HTTP ${status}).`);
  }
  if (status === 429) {
    const suffix = ctx.retryAfter ? ` (Retry-After: ${ctx.retryAfter})` : '';
    return new CollectionRateLimitedError(`DataJud aplicou limite de requisições${suffix}.`, 429);
  }
  if (status >= 500) {
    return new CollectionUnavailableError(`DataJud indisponível (HTTP ${status}).`);
  }
  // 404 no endpoint `_search` significa alias/rota errada — não é "processo ausente"
  // (esse caso é HTTP 200 + zero hits). Tratamos como erro de configuração não retriável.
  return new CollectionError(
    'unknown',
    `DataJud respondeu HTTP ${status} de forma inesperada.`,
    false,
    status,
  );
}
