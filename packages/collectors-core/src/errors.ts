import type { SourceKind } from './source.js';

export class SourceNotRegisteredError extends Error {
  constructor(public readonly kind: SourceKind) {
    super(`Nenhuma fonte registrada para '${kind}'.`);
    this.name = 'SourceNotRegisteredError';
  }
}

export class SourceAlreadyRegisteredError extends Error {
  constructor(public readonly kind: SourceKind) {
    super(`Fonte '${kind}' já registrada.`);
    this.name = 'SourceAlreadyRegisteredError';
  }
}

/** A fonte existe mas está indisponível (rede, tribunal fora do ar, etc.). */
export class SourceUnavailableError extends Error {
  constructor(
    public readonly kind: SourceKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`Fonte '${kind}' indisponível: ${message}`, options);
    this.name = 'SourceUnavailableError';
  }
}
