import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BIRTHDAY_TEMPLATES } from '@juriflow/shared-types';
import { localDay, renderBirthdayMessage } from '../domain/birthday-template.js';
import type { Logger } from '../infra/logger.js';
import type { BirthdayPerson, BirthdayRepository } from '../ports/birthday.port.js';
import { BirthdayJob } from './birthday.job.js';
import { SerialQueue } from './serial-queue.js';

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

function person(overrides: Partial<BirthdayPerson>): BirthdayPerson {
  return {
    spaceId: 'space-1',
    spaceName: 'Escritório Alfa',
    type: 'client',
    recipientId: 'client-1',
    fullName: 'Maria da Silva',
    phone: '+5592900000001',
    done: false,
    ...overrides,
  };
}

function setup(options: {
  people: BirthdayPerson[];
  connected?: boolean;
  templates?: { team: string | null; client: string | null };
  failSend?: boolean;
}): {
  job: BirthdayJob;
  repository: {
    listOn: ReturnType<typeof vi.fn>;
    templatesFor: ReturnType<typeof vi.fn>;
    recordSent: ReturnType<typeof vi.fn>;
    recordFailed: ReturnType<typeof vi.fn>;
  };
  notifier: { sendText: ReturnType<typeof vi.fn> };
} {
  const repository = {
    listOn: vi.fn(async () => options.people),
    templatesFor: vi.fn(async () => options.templates ?? { team: null, client: null }),
    recordSent: vi.fn(async () => {}),
    recordFailed: vi.fn(async () => {}),
  } satisfies BirthdayRepository;
  const notifier = {
    sendText: vi.fn(async () => {
      if (options.failSend) throw new Error('WAHA fora do ar');
    }),
  };
  const job = new BirthdayJob(
    repository,
    { isConnected: async () => options.connected ?? true },
    notifier,
    new SerialQueue(),
    silentLogger,
    'America/Manaus',
  );
  return { job, repository, notifier };
}

describe('mensagem de aniversário', () => {
  it('usa o primeiro nome e o nome do escritório', () => {
    expect(
      renderBirthdayMessage('Parabéns, {{nome}}! — {{escritorio}}', {
        fullName: '  Maria da Silva ',
        spaceName: 'Escritório Alfa',
      }),
    ).toBe('Parabéns, Maria! — Escritório Alfa');
  });

  it('o dia é o do fuso do escritório (23h em Manaus ainda é o mesmo dia)', () => {
    expect(localDay(new Date('2026-05-11T03:30:00Z'), 'America/Manaus')).toBe('2026-05-10');
  });
});

describe('BirthdayJob', () => {
  it('envia com o padrão do sistema por público e registra', async () => {
    const { job, notifier, repository } = setup({
      people: [
        person({}),
        person({
          type: 'team',
          recipientId: 'profile-1',
          fullName: 'Carlos',
          phone: '+5592900000002',
        }),
      ],
    });
    await job.run(new Date('2026-05-10T13:00:00Z'));

    expect(repository.listOn).toHaveBeenCalledWith('2026-05-10');
    expect(notifier.sendText).toHaveBeenCalledWith(
      'space-1',
      '+5592900000001',
      renderBirthdayMessage(DEFAULT_BIRTHDAY_TEMPLATES.client.body, {
        fullName: 'Maria da Silva',
        spaceName: 'Escritório Alfa',
      }),
    );
    expect(notifier.sendText).toHaveBeenCalledWith(
      'space-1',
      '+5592900000002',
      expect.stringContaining('Toda a equipe do Escritório Alfa'),
    );
    expect(repository.recordSent).toHaveBeenCalledTimes(2);
  });

  it('usa o template escolhido pelo ADMIN', async () => {
    const { job, notifier } = setup({
      people: [person({})],
      templates: { team: null, client: 'Feliz dia, {{nome}}!' },
    });
    await job.run();
    expect(notifier.sendText).toHaveBeenCalledWith(
      'space-1',
      '+5592900000001',
      'Feliz dia, Maria!',
    );
  });

  it('quem já recebeu hoje não recebe de novo', async () => {
    const { job, notifier } = setup({ people: [person({ done: true })] });
    await job.run();
    expect(notifier.sendText).not.toHaveBeenCalled();
  });

  it('WhatsApp desconectado: não tenta nem registra — fica para a próxima rodada', async () => {
    const { job, notifier, repository } = setup({ people: [person({})], connected: false });
    await job.run();
    expect(notifier.sendText).not.toHaveBeenCalled();
    expect(repository.recordFailed).not.toHaveBeenCalled();
  });

  it('falha no envio fica registrada para tentar de novo', async () => {
    const { job, repository } = setup({ people: [person({})], failSend: true });
    await job.run();
    expect(repository.recordFailed).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: 'client-1' }),
      'WAHA fora do ar',
    );
  });
});
