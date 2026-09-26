import type { Logger } from '../infra/logger.js';
import type { ProcessRepository } from '../ports/process-repository.port.js';
import type { TrackProcessUseCase } from '../usecases/track-process.usecase.js';
import type { SerialQueue } from './serial-queue.js';

/**
 * Polling dos pedidos de "consultar agora" (RN seção 39, migração 0032). O
 * usuário só grava a intenção via RPC `request_process_check`; este job coleta
 * e tira o processo da fila — mesmo quando a coleta falha, para um erro na
 * fonte não prender o pedido em loop (o erro fica em last_check_error).
 */
export class CheckRequestJob {
  private running = false;

  constructor(
    private readonly useCase: TrackProcessUseCase,
    private readonly processRepository: ProcessRepository,
    private readonly queue: SerialQueue,
    private readonly logger: Logger,
    private readonly batchSize = 5,
  ) {}

  async tick(): Promise<void> {
    // setInterval não espera a coleta anterior terminar: sem esta trava, um
    // tick lento faria o próximo pegar os mesmos pedidos.
    if (this.running) return;
    this.running = true;
    try {
      const ids = await this.processRepository.listCheckRequestedIds(this.batchSize);
      for (const id of ids) await this.handle(id);
    } finally {
      this.running = false;
    }
  }

  private async handle(processId: string): Promise<void> {
    try {
      const process = await this.processRepository.findTrackableProcessById(processId);
      if (!process) {
        this.logger.warn('Pedido de consulta para processo não rastreável — descartado.', {
          processId,
        });
        return;
      }
      const result = await this.queue.run(() => this.useCase.execute(process));
      this.logger.info('Consulta manual concluída.', { ...result });
    } catch (error) {
      this.logger.error('Consulta manual falhou.', { processId, error: String(error) });
    } finally {
      await this.processRepository.clearCheckRequest(processId).catch((error) =>
        this.logger.error('Falha ao limpar pedido de consulta.', {
          processId,
          error: String(error),
        }),
      );
    }
  }
}
