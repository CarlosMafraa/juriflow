import type {
  ProcessDataSource,
  RawMovement,
  SourceFetchInput,
  SourceFetchResult,
  SourceKind,
  SourceTarget,
} from '@juriflow/collectors-core';
import { CollectionNotFoundError } from '@juriflow/collector-engine';

import type { BrowserCaseRunner, BrowserMovement } from './browser-runner.js';

export interface PlaywrightCollectorOptions {
  /** Identificador da fonte. Default: `'projudi_tjam'`. */
  readonly kind?: SourceKind;
  /**
   * Navegação por navegador — a implementação Playwright + Edge chega na Etapa 10.
   * Injetada para que o collector seja testável sem navegador nem site externo.
   */
  readonly runner: BrowserCaseRunner;
  /** Relógio injetável (testes determinísticos). Default: `() => new Date()`. */
  readonly now?: () => Date;
}

/**
 * Collector baseado em navegador. Implementa `ProcessDataSource`
 * (`@juriflow/collectors-core`) — o mesmo contrato do `adapter-datajud`.
 *
 * Responsabilidade: exigir CNJ, chamar o `BrowserCaseRunner` e mapear o
 * resultado cru para `RawMovement[]` / `SourceFetchResult`. NÃO normaliza,
 * NÃO detecta mudança, NÃO persiste — isso é do `@juriflow/collector-engine`.
 *
 * NÃO conhece navegador, seletores nem Playwright — só a porta `BrowserCaseRunner`
 * (que a Etapa 10 implementa com Playwright + Microsoft Edge).
 */
export class PlaywrightCollector implements ProcessDataSource {
  readonly kind: SourceKind;

  private readonly runner: BrowserCaseRunner;
  private readonly now: () => Date;

  constructor(options: PlaywrightCollectorOptions) {
    this.kind = options.kind ?? 'projudi_tjam';
    this.runner = options.runner;
    this.now = options.now ?? ((): Date => new Date());
  }

  /**
   * Sabe coletar qualquer alvo que tenha número CNJ. A escolha de URL/fluxo por
   * tribunal é do `BrowserCaseRunner` (via `courtId`), não deste método.
   */
  canHandle(target: SourceTarget): boolean {
    return typeof target.cnjNumber === 'string' && target.cnjNumber.trim().length > 0;
  }

  async fetch(input: SourceFetchInput): Promise<SourceFetchResult> {
    const { target } = input;
    const collectedAt = this.now().toISOString();

    if (target.cnjNumber === null || target.cnjNumber.trim().length === 0) {
      // Sem CNJ não há o que consultar. Resultado vazio (não é falha) — mesma
      // semântica do DataJudAdapter para alvo sem número.
      return { sourceKind: this.kind, collectedAt, movements: [] };
    }

    const outcome = await this.runner.run({
      cnjNumber: target.cnjNumber,
      courtId: target.courtId,
      ...(target.params !== undefined ? { params: target.params } : {}),
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    });

    if (outcome.status === 'not_found') {
      throw new CollectionNotFoundError();
    }

    const movements: RawMovement[] = outcome.movements.map((m: BrowserMovement) => ({
      sourceKind: this.kind,
      sourceMovementId: m.sourceMovementId,
      occurredAt: m.occurredAt,
      description: m.description,
      raw: m.raw ?? { description: m.description },
    }));

    const result: SourceFetchResult = {
      sourceKind: this.kind,
      collectedAt,
      movements,
    };
    return outcome.partial === true ? { ...result, partial: true } : result;
  }
}
