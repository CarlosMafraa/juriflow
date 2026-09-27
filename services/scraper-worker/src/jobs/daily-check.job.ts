import type { Logger } from '../infra/logger.js';
import type { ProcessRepository } from '../ports/process-repository.port.js';
import type { TrackProcessUseCase } from '../usecases/track-process.usecase.js';
import type { SerialQueue } from './serial-queue.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rotina diária (RN seção 13): percorre todos os processos rastreáveis,
 * sequencialmente e com um intervalo mínimo entre eles (não sobrecarregar a
 * fonte). Falha em 1 processo não interrompe os demais.
 */
export class DailyCheckJob {
  private running = false;

  constructor(
    private readonly useCase: TrackProcessUseCase,
    private readonly processRepository: ProcessRepository,
    private readonly queue: SerialQueue,
    private readonly logger: Logger,
    private readonly throttleMs: number,
  ) {}

  async run(): Promise<void> {
    // Com muitos processos a rotina pode passar de 24h; nunca duas ao mesmo tempo.
    if (this.running) {
      this.logger.warn('Rotina diária anterior ainda em execução — disparo ignorado.');
      return;
    }
    this.running = true;
    try {
      await this.runAll();
    } finally {
      this.running = false;
    }
  }

  private async runAll(): Promise<void> {
    const processes = await this.processRepository.listTrackableProcesses();
    this.logger.info('Rotina diária de acompanhamento iniciada.', { total: processes.length });

    for (const process of processes) {
      try {
        // Um processo por vez na fila compartilhada: pedidos de "consultar
        // agora" entram entre um processo e outro, sem esperar a rotina toda.
        const result = await this.queue.run(() => this.useCase.execute(process));
        this.logger.info('Processo verificado.', { ...result });
      } catch {
        // Já logado dentro do use case (com o erro persistido em processes.last_check_error).
        // Segue para o próximo processo — falha de 1 não trava a rotina.
      }
      await sleep(this.throttleMs);
    }

    this.logger.info('Rotina diária de acompanhamento concluída.');
  }
}
