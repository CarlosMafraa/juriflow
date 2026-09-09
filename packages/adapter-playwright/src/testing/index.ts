/**
 * Utilitários de teste do `@juriflow/adapter-playwright`.
 *
 * `FakeBrowserCaseRunner` substitui a implementação Playwright + Edge (Etapa 10)
 * nos testes: nada de navegador, nada de site externo.
 */
import type {
  BrowserCaseOutcome,
  BrowserCaseQuery,
  BrowserCaseRunner,
  BrowserMovement,
} from '../browser-runner.js';

export interface FakeRunnerScenario {
  /** O que o `run()` devolve. Default: `{ status: 'found', movements: [] }`. */
  readonly outcome?: BrowserCaseOutcome;
  /** Se definido, `run()` lança isto em vez de devolver (erro de consulta). */
  readonly throws?: unknown;
}

/** `BrowserCaseRunner` falso e determinístico; registra as consultas recebidas. */
export class FakeBrowserCaseRunner implements BrowserCaseRunner {
  readonly calls: BrowserCaseQuery[] = [];

  constructor(private readonly scenario: FakeRunnerScenario = {}) {}

  async run(query: BrowserCaseQuery): Promise<BrowserCaseOutcome> {
    this.calls.push(query);
    if (this.scenario.throws !== undefined) {
      throw this.scenario.throws;
    }
    return this.scenario.outcome ?? { status: 'found', movements: [] };
  }
}

/** Ajuda para montar `BrowserMovement` nos testes. */
export function fakeMovement(
  overrides: Partial<BrowserMovement> & { description: string },
): BrowserMovement {
  return {
    sourceMovementId: overrides.sourceMovementId ?? null,
    occurredAt: overrides.occurredAt ?? null,
    description: overrides.description,
    ...(overrides.raw !== undefined ? { raw: overrides.raw } : {}),
  };
}
