import { describe, expect, it } from 'vitest';
import type { Logger } from '../infra/logger.js';
import type { ProcessRepository, TrackableProcess } from '../ports/process-repository.port.js';
import type { TrackProcessUseCase } from '../usecases/track-process.usecase.js';
import { CheckRequestJob } from './check-request.job.js';
import { SerialQueue } from './serial-queue.js';

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

function trackable(id: string): TrackableProcess {
  return {
    id,
    spaceId: 'space-1',
    cnjNumber: '0000001-23.2024.8.04.0001',
    courtId: 'court-1',
    sourceKind: 'projudi_tjam',
    lastStateHash: null,
  };
}

function setup(options: { pending: string[]; trackable?: Set<string>; failOn?: Set<string> }): {
  job: CheckRequestJob;
  executed: string[];
  cleared: string[];
} {
  const pending = [...options.pending];
  const executed: string[] = [];
  const cleared: string[] = [];

  const repository = {
    listCheckRequestedIds: async (limit: number) => pending.slice(0, limit),
    findTrackableProcessById: async (id: string) =>
      (options.trackable ?? new Set(options.pending)).has(id) ? trackable(id) : null,
    clearCheckRequest: async (id: string) => {
      cleared.push(id);
      pending.splice(pending.indexOf(id), 1);
    },
  } as unknown as ProcessRepository;

  const useCase = {
    execute: async (process: TrackableProcess) => {
      executed.push(process.id);
      if (options.failOn?.has(process.id)) throw new Error('fonte fora do ar');
      return { processId: process.id };
    },
  } as unknown as TrackProcessUseCase;

  const job = new CheckRequestJob(useCase, repository, new SerialQueue(), silentLogger);
  return { job, executed, cleared };
}

describe('CheckRequestJob', () => {
  it('coleta cada pedido pendente e tira da fila', async () => {
    const { job, executed, cleared } = setup({ pending: ['p1', 'p2'] });
    await job.tick();
    expect(executed).toEqual(['p1', 'p2']);
    expect(cleared).toEqual(['p1', 'p2']);
  });

  it('tira da fila mesmo quando a coleta falha (sem loop infinito)', async () => {
    const { job, executed, cleared } = setup({ pending: ['p1', 'p2'], failOn: new Set(['p1']) });
    await job.tick();
    expect(executed).toEqual(['p1', 'p2']);
    expect(cleared).toEqual(['p1', 'p2']);
  });

  it('descarta pedido de processo que deixou de ser rastreável', async () => {
    const { job, executed, cleared } = setup({ pending: ['p1'], trackable: new Set() });
    await job.tick();
    expect(executed).toEqual([]);
    expect(cleared).toEqual(['p1']);
  });

  it('não sobrepõe ticks concorrentes', async () => {
    const { job, executed } = setup({ pending: ['p1'] });
    await Promise.all([job.tick(), job.tick()]);
    expect(executed).toEqual(['p1']);
  });
});

describe('SerialQueue', () => {
  it('executa uma tarefa de cada vez, na ordem, mesmo com falhas', async () => {
    const queue = new SerialQueue();
    const log: string[] = [];
    const task =
      (name: string, ms: number, fail = false) =>
      () =>
        new Promise<void>((resolve, reject) => {
          log.push(`start ${name}`);
          setTimeout(() => {
            log.push(`end ${name}`);
            if (fail) reject(new Error(name));
            else resolve();
          }, ms);
        });

    await Promise.allSettled([queue.run(task('a', 20, true)), queue.run(task('b', 1))]);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b']);
  });
});
