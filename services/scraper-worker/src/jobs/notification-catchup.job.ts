import type { Logger } from '../infra/logger.js';
import type {
  CatchupRequest,
  NotificationCatchupQueue,
} from '../ports/notification-catchup-queue.port.js';
import type { ProcessRepository } from '../ports/process-repository.port.js';
import type { TrackProcessUseCase } from '../usecases/track-process.usecase.js';
import type { SerialQueue } from './serial-queue.js';

/**
 * Fila de avisos pendentes (N10, migração 0046). Quando a configuração de
 * notificação muda, entra responsável/cliente ou o WhatsApp conecta, o banco
 * enfileira o processo; este job envia o que falta SEM consultar o tribunal
 * — ninguém precisa esperar a próxima consulta nem clicar em "consultar agora".
 */
export class NotificationCatchupJob {
  private running = false;

  constructor(
    private readonly useCase: TrackProcessUseCase,
    private readonly processRepository: ProcessRepository,
    private readonly catchupQueue: NotificationCatchupQueue,
    private readonly queue: SerialQueue,
    private readonly logger: Logger,
    private readonly batchSize = 10,
  ) {}

  async tick(): Promise<void> {
    // O envio espera 30–60 s entre mensagens: sem a trava, o próximo tick
    // pegaria os mesmos pedidos ainda em andamento.
    if (this.running) return;
    this.running = true;
    try {
      const requests = await this.catchupQueue.list(this.batchSize);
      for (const request of requests) await this.handle(request);
    } finally {
      this.running = false;
    }
  }

  private async handle(request: CatchupRequest): Promise<void> {
    const { processId } = request;
    try {
      // Manual ou com sincronização: o modo decide qual fonte avisa.
      const process = await this.processRepository.findNotifiableProcessById(processId);
      if (!process) return; // processo arquivado/excluído ou espaço suspenso
      const outcome = await this.queue.run(() => this.useCase.notifyPending(process));
      if (outcome.sent > 0 || outcome.failed > 0 || outcome.channelOffline) {
        this.logger.info('Avisos pendentes processados.', { processId, ...outcome });
      }
    } catch (error) {
      this.logger.error('Falha ao enviar avisos pendentes.', { processId, error: String(error) });
    } finally {
      // Sai da fila mesmo com falha: o que não foi entregue continua pendente
      // e vai na próxima consulta ou no próximo pedido (N7).
      await this.catchupQueue
        .clear(request)
        .catch((error) =>
          this.logger.error('Falha ao limpar aviso pendente.', { processId, error: String(error) }),
        );
    }
  }
}
