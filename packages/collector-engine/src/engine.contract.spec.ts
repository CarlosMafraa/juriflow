import { describe, expect, it } from 'vitest';
import type {
  ProcessDataSource,
  RawMovement,
  SourceFetchResult,
} from '@juriflow/collectors-core';
import { SourceUnavailableError } from '@juriflow/collectors-core';
import type { CategoryHint, CategoryResolver } from '@juriflow/movement-normalizer';
import { runCollection } from './engine.js';
import {
  CollectionAuthError,
  CollectionNotFoundError,
  CollectionParseError,
  CollectionRateLimitedError,
  CollectionTimeoutError,
  CollectionUnavailableError,
} from './errors.js';
import contract from '../../../contracts/collector-engine/run-collection.json' with { type: 'json' };

/**
 * Contrato de `runCollection` compartilhado com a implementação Go
 * (Acompanhamento-H, etapa 4). Os mesmos vetores de
 * `contracts/collector-engine/run-collection.json` — gerados por
 * `scripts/extract-contract-vectors.mjs` executando este mesmo `runCollection`
 * — são consumidos aqui (regressão do lado TS) e pelo `go test` equivalente.
 * `collectedAt` só é comparado no caminho de sucesso/partial; no de falha é
 * wall-clock e o vetor o omite.
 */

function fetchError(name: string, kind: string): unknown {
  switch (name) {
    case 'timeout':
      return new CollectionTimeoutError();
    case 'unavailable':
      return new CollectionUnavailableError();
    case 'source_unavailable':
      return new SourceUnavailableError(kind, 'simulado');
    case 'rate_limited':
      return new CollectionRateLimitedError();
    case 'auth_failed':
      return new CollectionAuthError();
    case 'parse_error':
      return new CollectionParseError();
    case 'not_found':
      return new CollectionNotFoundError();
    default:
      throw new Error(`fetchError: nome desconhecido ${name}`);
  }
}

function deterministicSource(
  kind: string,
  fetchSpec: { throw: string | null; movements: RawMovement[]; partial: boolean },
  collectedAt: string,
): ProcessDataSource {
  return {
    kind,
    canHandle: () => true,
    fetch: async (): Promise<SourceFetchResult> => {
      if (fetchSpec.throw) throw fetchError(fetchSpec.throw, kind);
      const result: SourceFetchResult = { sourceKind: kind, collectedAt, movements: fetchSpec.movements };
      return fetchSpec.partial ? { ...result, partial: true } : result;
    },
  };
}

function playbackResolver(
  resolutions: ({ code: string; label: string } | null)[],
): CategoryResolver {
  let i = 0;
  return (_hint: CategoryHint) => {
    if (i >= resolutions.length) {
      throw new Error(`resolveCategory chamado ${i + 1}x; vetor previu ${resolutions.length}`);
    }
    return resolutions[i++] ?? null;
  };
}

describe('runCollection — vetores de contrato', () => {
  it.each(contract.vectors)('$name', async (v) => {
    const expected = v.expected as Record<string, unknown>;
    const collectedAt = typeof expected.collectedAt === 'string' ? expected.collectedAt : '';

    const out = await runCollection({
      source: deterministicSource(v.input.sourceKind, v.fetch as never, collectedAt),
      target: { cnjNumber: '0000001-23.2024.8.04.0001', courtId: 'court-1' },
      isFirstSync: v.input.isFirstSync,
      known: v.input.known as never,
      previousStateHash: v.input.previousStateHash,
      sourceKind: v.input.sourceKind,
      resolveCategory: playbackResolver(v.categoryResolutions as never),
    });

    const got = JSON.parse(JSON.stringify(out)) as Record<string, unknown>;
    if (got.status === 'failed') delete got.collectedAt;

    expect(got).toEqual(expected);
  });
});
