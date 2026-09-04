import type {
  ProcessDataSource,
  RawMovement,
  SourceFetchInput,
  SourceFetchResult,
  SourceKind,
  SourceTarget,
} from '@juriflow/collectors-core';
import { SourceUnavailableError } from '@juriflow/collectors-core';
import {
  CollectionAuthError,
  CollectionNotFoundError,
  CollectionParseError,
  CollectionRateLimitedError,
  CollectionTimeoutError,
  CollectionUnavailableError,
} from '../errors.js';

export type MockFailure =
  | 'timeout'
  | 'unavailable'
  | 'source_unavailable'
  | 'rate_limited'
  | 'auth_failed'
  | 'parse_error'
  | 'not_found';

export interface MockScenario {
  readonly kind?: SourceKind;
  readonly handles?: boolean;
  /** Páginas de movimentações brutas; concatenadas na coleta. */
  readonly pages?: readonly (readonly RawMovement[])[];
  readonly failWith?: MockFailure;
  /** Retorna só as N primeiras páginas e marca `partial: true`. */
  readonly partialAfterPage?: number;
  /** Se true, filtra as movimentações por `since` (coleta incremental). */
  readonly honorSince?: boolean;
}

/**
 * Fonte simulada para a Acompanhamento-A. Cobre: 1ª coleta, novas movimentações,
 * movimentação alterada, paginação, coleta parcial, timeout, indisponibilidade,
 * rate limit, processo não encontrado, erro de parsing.
 * Implementa apenas o contrato `ProcessDataSource`.
 */
export class MockSourceAdapter implements ProcessDataSource {
  readonly kind: SourceKind;

  constructor(private readonly scenario: MockScenario = {}) {
    this.kind = scenario.kind ?? 'datajud';
  }

  canHandle(_target: SourceTarget): boolean {
    return this.scenario.handles ?? true;
  }

  async fetch(input: SourceFetchInput): Promise<SourceFetchResult> {
    switch (this.scenario.failWith) {
      case 'timeout':
        throw new CollectionTimeoutError();
      case 'unavailable':
        throw new CollectionUnavailableError();
      case 'source_unavailable':
        throw new SourceUnavailableError(this.kind, 'simulado');
      case 'rate_limited':
        throw new CollectionRateLimitedError();
      case 'auth_failed':
        throw new CollectionAuthError();
      case 'parse_error':
        throw new CollectionParseError();
      case 'not_found':
        throw new CollectionNotFoundError();
      default:
        break;
    }

    const pages = this.scenario.pages ?? [];
    const cut = this.scenario.partialAfterPage;
    const usable = cut != null ? pages.slice(0, cut) : pages;
    let movements = usable.flat();

    if (this.scenario.honorSince && input.since) {
      const since = input.since.getTime();
      movements = movements.filter(
        (m) => !m.occurredAt || new Date(m.occurredAt).getTime() >= since,
      );
    }

    const result: SourceFetchResult = {
      sourceKind: this.kind,
      collectedAt: new Date().toISOString(),
      movements,
    };
    if (cut != null && cut < pages.length) {
      return { ...result, partial: true };
    }
    return result;
  }
}

/** Ajuda para construir `RawMovement` nos testes. */
export function rawMovement(
  overrides: Partial<RawMovement> & { description: string },
): RawMovement {
  return {
    sourceKind: overrides.sourceKind ?? 'datajud',
    sourceMovementId: overrides.sourceMovementId ?? null,
    occurredAt: overrides.occurredAt ?? null,
    description: overrides.description,
    raw: overrides.raw ?? { description: overrides.description },
  };
}
