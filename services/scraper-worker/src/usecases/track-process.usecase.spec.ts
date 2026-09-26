import { describe, expect, it, vi } from 'vitest';
import {
  SourceRegistry,
  type ProcessDataSource,
  type RawMovement,
} from '@juriflow/collectors-core';
import { GeneralMovementTemplate } from '../domain/message-template.js';
import type { Logger } from '../infra/logger.js';
import type { EffectiveNotificationConfig } from '../domain/notification-config.js';
import type { NotificationConfigResolver } from '../ports/notification-config.port.js';
import type { NotificationLog } from '../ports/notification-log.port.js';
import type { Notifier } from '../ports/notifier.port.js';
import type { MovementRepository, StoredMovement } from '../ports/movement-repository.port.js';
import type { ProcessRepository, TrackableProcess } from '../ports/process-repository.port.js';
import type { NotificationRecipient, RecipientResolver } from '../ports/recipient-resolver.port.js';
import type { TemplateRepository } from '../ports/template-repository.port.js';
import { TrackProcessUseCase } from './track-process.usecase.js';

const PROCESS: TrackableProcess = {
  id: 'process-1',
  spaceId: 'space-1',
  cnjNumber: '0000001-23.2026.8.04.0001',
  courtId: 'court-1',
  sourceKind: 'fake',
  lastStateHash: 'hash-anterior', // não é a 1ª coleta
};

const NEW_MOVEMENT: RawMovement = {
  sourceKind: 'fake',
  sourceMovementId: 'mov-1',
  occurredAt: '2026-09-20T12:00:00.000Z',
  description: 'Sentença publicada',
  raw: {},
};

const DEFAULT_CONFIG: EffectiveNotificationConfig = {
  notifyResponsible: true,
  notifyClients: true,
  responsibleTemplateId: null,
  clientTemplateId: null,
};

function buildRegistry(movements: RawMovement[]): SourceRegistry {
  const source: ProcessDataSource = {
    kind: 'fake',
    canHandle: () => true,
    fetch: async () => ({ sourceKind: 'fake', collectedAt: new Date().toISOString(), movements }),
  };
  const registry = new SourceRegistry();
  registry.register('fake', () => source);
  return registry;
}

function buildLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

interface Harness {
  useCase: TrackProcessUseCase;
  notifier: { sendText: ReturnType<typeof vi.fn> };
  notificationLog: NotificationLog;
  recipients: NotificationRecipient[];
}

function buildHarness(options: {
  config?: EffectiveNotificationConfig;
  recipients?: NotificationRecipient[];
  alreadySent?: boolean;
  templateBody?: string | null;
  movements?: RawMovement[];
}): Harness {
  const recipients = options.recipients ?? [
    { type: 'responsible', phone: '+5592900000001', recipientId: 'profile-1' },
    { type: 'client', phone: '+5592900000002', recipientId: 'client-1' },
  ];

  const registry = buildRegistry(options.movements ?? [NEW_MOVEMENT]);

  const processRepository: ProcessRepository = {
    listTrackableProcesses: async () => [PROCESS],
    findTrackableProcessById: async () => PROCESS,
    updateTrackingState: async () => {},
    listCheckRequestedIds: async () => [],
    clearCheckRequest: async () => {},
  };

  let storedIdSeq = 0;
  const movementRepository: MovementRepository = {
    listKnownHashes: async () => new Set(),
    insertNewMovements: async (_processId, _spaceId, movements) =>
      movements.map((m): StoredMovement => ({
        id: `stored-${++storedIdSeq}`,
        contentHash: m.contentHash,
        description: m.description,
        occurredAt: m.occurredAt,
      })),
  };

  const recipientResolver: RecipientResolver = {
    resolveRecipients: async () => recipients,
  };

  const notificationConfigResolver: NotificationConfigResolver = {
    resolve: async () => options.config ?? DEFAULT_CONFIG,
  };

  const templateRepository: TemplateRepository = {
    getBodyById: async () => options.templateBody ?? null,
  };

  const notifier = { sendText: vi.fn(async () => {}) };

  const notificationLog: NotificationLog = {
    wasAlreadySent: async () => options.alreadySent ?? false,
    recordSent: vi.fn(async () => {}),
    recordFailed: vi.fn(async () => {}),
  };

  const useCase = new TrackProcessUseCase(
    registry,
    processRepository,
    movementRepository,
    recipientResolver,
    notificationConfigResolver,
    templateRepository,
    notifier as unknown as Notifier,
    notificationLog,
    new GeneralMovementTemplate(),
    buildLogger(),
  );

  return { useCase, notifier, notificationLog, recipients };
}

describe('TrackProcessUseCase — motor de notificações', () => {
  it('1ª coleta (lastStateHash null) não notifica ninguém, mesmo com movimentações novas', async () => {
    const { useCase, notifier } = buildHarness({});
    const firstSyncProcess: TrackableProcess = { ...PROCESS, lastStateHash: null };
    const result = await useCase.execute(firstSyncProcess);
    expect(result.notificationsSent).toBe(0);
    expect(notifier.sendText).not.toHaveBeenCalled();
  });

  it('sem config específica, notifica responsável e cliente normalmente', async () => {
    const { useCase, notifier } = buildHarness({});
    const result = await useCase.execute(PROCESS);
    expect(result.notificationsSent).toBe(2);
    expect(notifier.sendText).toHaveBeenCalledTimes(2);
  });

  it('notifyResponsible=false remove o responsável da lista, mas mantém o cliente', async () => {
    const { useCase, notifier } = buildHarness({
      config: { ...DEFAULT_CONFIG, notifyResponsible: false },
    });
    const result = await useCase.execute(PROCESS);
    expect(result.notificationsSent).toBe(1);
    expect(notifier.sendText).toHaveBeenCalledTimes(1);
    expect(notifier.sendText).toHaveBeenCalledWith(
      PROCESS.spaceId,
      '+5592900000002',
      expect.any(String),
    );
  });

  it('notifyClients=false remove os clientes, mas mantém o responsável', async () => {
    const { useCase, notifier } = buildHarness({
      config: { ...DEFAULT_CONFIG, notifyClients: false },
    });
    const result = await useCase.execute(PROCESS);
    expect(result.notificationsSent).toBe(1);
    expect(notifier.sendText).toHaveBeenCalledWith(
      PROCESS.spaceId,
      '+5592900000001',
      expect.any(String),
    );
  });

  it('notifyResponsible=false e notifyClients=false: nenhuma notificação, mesmo com movimentação nova', async () => {
    const { useCase, notifier } = buildHarness({
      config: {
        notifyResponsible: false,
        notifyClients: false,
        responsibleTemplateId: null,
        clientTemplateId: null,
      },
    });
    const result = await useCase.execute(PROCESS);
    expect(result.notificationsSent).toBe(0);
    expect(notifier.sendText).not.toHaveBeenCalled();
  });

  it('usa o template customizado do responsável quando configurado, e o genérico para o cliente', async () => {
    const { useCase, notifier } = buildHarness({
      config: { ...DEFAULT_CONFIG, responsibleTemplateId: 'tpl-1' },
      templateBody: 'Mensagem custom para {{numero_processo}}',
    });
    await useCase.execute(PROCESS);

    const responsibleCall = notifier.sendText.mock.calls.find((c) => c[1] === '+5592900000001');
    const clientCall = notifier.sendText.mock.calls.find((c) => c[1] === '+5592900000002');
    expect(responsibleCall?.[2]).toBe(`Mensagem custom para ${PROCESS.cnjNumber}`);
    expect(clientCall?.[2]).toContain('Olá! Houve uma nova movimentação');
  });

  it('não reenvia para quem já recebeu esta movimentação (idempotência)', async () => {
    const { useCase, notifier } = buildHarness({ alreadySent: true });
    const result = await useCase.execute(PROCESS);
    expect(result.notificationsSent).toBe(0);
    expect(notifier.sendText).not.toHaveBeenCalled();
  });

  it('quando não há nenhum destinatário elegível, não consulta template nem envia nada', async () => {
    const { useCase, notifier } = buildHarness({ recipients: [] });
    const result = await useCase.execute(PROCESS);
    expect(result.notificationsSent).toBe(0);
    expect(notifier.sendText).not.toHaveBeenCalled();
  });
});
