import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Logger } from '../infra/logger.js';
import type { ProcessRepository } from '../ports/process-repository.port.js';
import type { TrackProcessUseCase } from '../usecases/track-process.usecase.js';
import type { SerialQueue } from '../jobs/serial-queue.js';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Endpoint operacional de "consultar agora" (RN seção 39), só para depuração
 * via túnel SSH. O botão do app NÃO usa esta rota: grava o pedido pela RPC
 * `request_process_check` e o CheckRequestJob consome. Sem autenticação
 * própria: a porta nunca deve ser publicada (ver infra/vps).
 */
export function createHttpServer(
  useCase: TrackProcessUseCase,
  processRepository: ProcessRepository,
  queue: SerialQueue,
  logger: Logger,
): Server {
  return createServer(async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    const match = url.pathname.match(/^\/check\/([^/]+)$/);
    if (req.method === 'POST' && match) {
      const processId = match[1] as string;
      try {
        const process = await processRepository.findTrackableProcessById(processId);
        if (!process) {
          sendJson(res, 404, {
            error: 'Processo não encontrado ou não rastreável (sem CNJ/fonte configurada).',
          });
          return;
        }
        const result = await queue.run(() => useCase.execute(process));
        sendJson(res, 200, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Falha na consulta manual.', { processId, error: message });
        sendJson(res, 502, { error: message });
      }
      return;
    }

    sendJson(res, 404, { error: 'Rota não encontrada.' });
  });
}
