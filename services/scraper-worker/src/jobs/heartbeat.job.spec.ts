import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../infra/logger.js';
import type { WorkerStatusReporter } from '../ports/worker-status.port.js';
import { HeartbeatJob } from './heartbeat.job.js';

const logger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function status(fail = false): WorkerStatusReporter {
  return {
    heartbeat: vi.fn(async () => {
      if (fail) throw new Error('banco fora');
    }),
    sourceSucceeded: vi.fn(async () => {}),
    sourceFailed: vi.fn(async () => {}),
  };
}

describe('HeartbeatJob', () => {
  it('grava o batimento e pinga o monitor externo', async () => {
    const s = status();
    const fetchFn = vi.fn(async () => new Response('OK'));
    await new HeartbeatJob(s, logger, 'https://hc-ping.com/uuid', fetchFn as never).tick();
    expect(s.heartbeat).toHaveBeenCalledOnce();
    expect(fetchFn).toHaveBeenCalledWith('https://hc-ping.com/uuid', expect.anything());
  });

  it('sem URL de monitor, só grava no banco', async () => {
    const fetchFn = vi.fn();
    await new HeartbeatJob(status(), logger, null, fetchFn as never).tick();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('banco fora do ar não impede o ping (o monitor continua sabendo que o worker vive)', async () => {
    const fetchFn = vi.fn(async () => new Response('OK'));
    await new HeartbeatJob(
      status(true),
      logger,
      'https://hc-ping.com/uuid',
      fetchFn as never,
    ).tick();
    expect(fetchFn).toHaveBeenCalledOnce();
  });
});
