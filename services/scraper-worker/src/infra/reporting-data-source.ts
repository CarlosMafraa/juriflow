import type {
  ProcessDataSource,
  SourceFetchInput,
  SourceFetchResult,
  SourceTarget,
} from '@juriflow/collectors-core';
import type { Logger } from './logger.js';
import type { WorkerStatusReporter } from '../ports/worker-status.port.js';

/**
 * Decorator: registra na saúde do worker se a consulta à fonte deu certo ou
 * falhou (ex.: firewall do TJAM respondendo "Request Rejected"). A fonte e o
 * pipeline não sabem que isso existe.
 */
export class ReportingDataSource implements ProcessDataSource {
  readonly kind: ProcessDataSource['kind'];

  constructor(
    private readonly inner: ProcessDataSource,
    private readonly status: WorkerStatusReporter,
    private readonly logger: Logger,
  ) {
    this.kind = inner.kind;
  }

  canHandle(target: SourceTarget): boolean {
    return this.inner.canHandle(target);
  }

  async fetch(input: SourceFetchInput): Promise<SourceFetchResult> {
    try {
      const result = await this.inner.fetch(input);
      await this.status.sourceSucceeded().catch((e) => this.warn(e));
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.status.sourceFailed(message).catch((e) => this.warn(e));
      throw error;
    }
  }

  private warn(error: unknown): void {
    this.logger.warn('Não foi possível registrar a saúde do worker.', { error: String(error) });
  }
}
