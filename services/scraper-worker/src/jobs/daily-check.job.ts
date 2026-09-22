import type { Logger } from '../infra/logger.js';
import type { ProcessRepository } from '../ports/process-repository.port.js';
import type { TrackProcessUseCase } from '../usecases/track-process.usecase.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rotina diária (RN seção 13): percorre todos os processos rastreáveis,
 * sequencialmente e com um intervalo mínimo entre eles (não sobrecarregar a
 * fonte). Falha em 1 processo não interrompe os demais.
 */
export class DailyCheckJob {
  constructor(
    private readonly useCase: TrackProcessUseCase,
    private readonly processRepository: ProcessRepository,
    private readonly logger: Logger,
    private readonly throttleMs: number,
  ) {}

  async run(): Promise<void> {
    const processes = await this.processRepository.listTrackableProcesses();
    this.logger.info('Rotina diária de acompanhamento iniciada.', { total: processes.length });

    for (const process of processes) {
      try {
        const result = await this.useCase.execute(process);
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
