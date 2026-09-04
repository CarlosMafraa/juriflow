export type CollectionErrorCode =
  | 'timeout'
  | 'unavailable'
  | 'rate_limited'
  | 'auth_failed'
  | 'parse_error'
  | 'not_found'
  | 'unknown';

export interface ClassifiedError {
  readonly code: CollectionErrorCode;
  readonly message: string;
  readonly retriable: boolean;
  readonly httpStatus?: number;
}

/** Erro de coleta com classificação explícita. Os adapters (e o Mock) lançam estes. */
export class CollectionError extends Error {
  constructor(
    readonly code: CollectionErrorCode,
    message: string,
    readonly retriable: boolean,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'CollectionError';
  }
}

export class CollectionTimeoutError extends CollectionError {
  constructor(message = 'Tempo limite excedido ao consultar a fonte.') {
    super('timeout', message, true);
  }
}
export class CollectionUnavailableError extends CollectionError {
  constructor(message = 'A fonte está indisponível.') {
    super('unavailable', message, true);
  }
}
export class CollectionRateLimitedError extends CollectionError {
  constructor(message = 'Limite de requisições da fonte atingido.', httpStatus = 429) {
    super('rate_limited', message, true, httpStatus);
  }
}
export class CollectionAuthError extends CollectionError {
  constructor(message = 'Credenciais inválidas ou expiradas para a fonte.') {
    super('auth_failed', message, false, 401);
  }
}
export class CollectionParseError extends CollectionError {
  constructor(message = 'Não foi possível interpretar a resposta da fonte.') {
    super('parse_error', message, false);
  }
}
export class CollectionNotFoundError extends CollectionError {
  constructor(message = 'Processo não encontrado na fonte.') {
    super('not_found', message, false, 404);
  }
}

/** Normaliza qualquer erro numa classificação. Desconhecido = retriável (limitado). */
export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof CollectionError) {
    return {
      code: err.code,
      message: err.message,
      retriable: err.retriable,
      ...(err.httpStatus !== undefined ? { httpStatus: err.httpStatus } : {}),
    };
  }
  const name = (err as { name?: string })?.name;
  const message = (err as { message?: string })?.message ?? String(err);
  if (name === 'SourceUnavailableError') {
    return { code: 'unavailable', message, retriable: true };
  }
  if (name === 'SourceNotRegisteredError') {
    return { code: 'unknown', message, retriable: false };
  }
  return { code: 'unknown', message, retriable: true };
}
