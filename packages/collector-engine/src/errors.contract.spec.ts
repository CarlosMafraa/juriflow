import { describe, expect, it } from 'vitest';
import { SourceNotRegisteredError, SourceUnavailableError } from '@juriflow/collectors-core';
import {
  classifyError,
  CollectionAuthError,
  CollectionNotFoundError,
  CollectionParseError,
  CollectionRateLimitedError,
  CollectionTimeoutError,
  CollectionUnavailableError,
} from './errors.js';
import contractVectors from '../../../contracts/collector-engine/classify-error.json' with { type: 'json' };

/**
 * Vetores de contrato de `classifyError` compartilhados com a futura
 * implementação Go (Acompanhamento-F, decisões F-1/F-2). Complementa (não
 * substitui) os testes de `runCollection — falhas` em `engine.spec.ts`, que
 * validam a integração via `MockSourceAdapter`; aqui o alvo é só a função
 * de classificação, chamada com os mesmos erros que aquele suite provoca.
 * Vetores gerados por `scripts/extract-contract-vectors.mjs` — não editar
 * `contracts/collector-engine/classify-error.json` à mão.
 */
function errorFor(name: string): unknown {
  switch (name) {
    case 'CollectionTimeoutError (default) ⇒ timeout, retriable':
      return new CollectionTimeoutError();
    case 'CollectionUnavailableError (default) ⇒ unavailable, retriable':
      return new CollectionUnavailableError();
    case 'CollectionRateLimitedError (default) ⇒ rate_limited, retriable, httpStatus=429':
      return new CollectionRateLimitedError();
    case 'CollectionAuthError (default) ⇒ auth_failed, não retriable, httpStatus=401':
      return new CollectionAuthError();
    case 'CollectionParseError (default) ⇒ parse_error, não retriable':
      return new CollectionParseError();
    case 'CollectionNotFoundError (default) ⇒ not_found, não retriable, httpStatus=404':
      return new CollectionNotFoundError();
    case 'Error genérico ⇒ unknown, retriable (limitado)':
      return new Error('boom');
    case "SourceUnavailableError (collectors-core) ⇒ unavailable, retriable":
      return new SourceUnavailableError('datajud', 'simulado');
    case 'SourceNotRegisteredError (collectors-core) ⇒ unknown, não retriable':
      return new SourceNotRegisteredError('minha-fonte');
    default:
      throw new Error(`vetor sem erro correspondente: ${name}`);
  }
}

describe('classifyError — vetores de contrato', () => {
  it.each(contractVectors.vectors)('$name', ({ name, expected }) => {
    expect(classifyError(errorFor(name))).toEqual(expected);
  });
});
