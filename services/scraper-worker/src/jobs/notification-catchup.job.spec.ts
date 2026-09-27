import { describe, expect, it } from 'vitest';
import type { Logger } from '../infra/logger.js';
import type {
  CatchupRequest,
  NotificationCatchupQueue,
} from '../ports/notification-catchup-queue.port.js';
import type { ProcessRepository, TrackableProcess } from '../ports/process-repository.port.js';
import type { TrackProcessUseCase } from '../usecases/track-process.usecase.js';
import { NotificationCatchupJob } from './notification-catchup.job.js';
import { SerialQueue } from './serial-queue.js';

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

function trackable(id: string): TrackableProcess {
  return {
    id,
    spaceId: 'space-1',
    cnjNumber: '0000001-23.2024.8.04.0001',
    courtId: 'court-1',
    sourceKind: 'projudi_tjam',
    lastStateHash: 'hash',
  };
}

function request(processId: string, trackingEnabled = true): CatchupRequest {
  return { processId, requestedAt: '2026-10-03T12:00:00.000Z', trackingEnabled };
}

function setup(options: { requests: CatchupRequest[]; failOn?: Set<string> }): {
  job: NotificationCatchupJob;
  notified: string[];
  cleared: CatchupRequest[];
} {
  const notified: string[] = [];
  const cleared: CatchupRequest[] = [];

  const catchupQueue: NotificationCatchupQueue = {
    list: async (limit) => options.requests.slice(0, limit),
    clear: async (r) => {
      cleared.push(r);
    },
  };
  const repository = {
    findTrackableProcessById: async (id: string) => trackable(id),
  } as unknown as ProcessRepository;
  const useCase = {
    notifyPending: async (process: TrackableProcess) => {
      notified.push(process.id);
      if (options.failOn?.has(process.id)) throw new Error('WAHA fora do ar');
      return { sent: 1, failed: 0, channelOffline: false };
    },
    execute: async () => {
      throw new Error('a fila de pendentes não pode consultar o tribunal');
    },
  } as unknown as TrackProcessUseCase;

  const job = new NotificationCatchupJob(
    useCase,
    repository,
    catchupQueue,
    new SerialQueue(),
    silentLogger,
  );
  return { job, notified, cleared };
}

describe('NotificationCatchupJob', () => {
  it('envia os pendentes sem consultar o tribunal e tira o pedido da fila', async () => {
    const r = request('p1');
    const { job, notified, cleared } = setup({ requests: [r] });
    await job.tick();
    expect(notified).toEqual(['p1']);
    expect(cleared).toEqual([r]);
  });

  it('sincronização desligada depois do pedido: descarta sem enviar', async () => {
    const r = request('p1', false);
    const { job, notified, cleared } = setup({ requests: [r] });
    await job.tick();
    expect(notified).toEqual([]);
    expect(cleared).toEqual([r]);
  });

  it('falha em um processo não trava os demais e o pedido sai da fila', async () => {
    const { job, notified, cleared } = setup({
      requests: [request('p1'), request('p2')],
      failOn: new Set(['p1']),
    });
    await job.tick();
    expect(notified).toEqual(['p1', 'p2']);
    expect(cleared.map((r) => r.processId)).toEqual(['p1', 'p2']);
  });
});
