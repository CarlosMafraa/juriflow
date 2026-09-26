import { describe, expect, it, vi } from 'vitest';
import {
  SourceRegistry,
  type ProcessDataSource,
  type RawMovement,
} from '@juriflow/collectors-core';
import { GeneralMovementTemplate } from '../domain/message-template.js';
import type { Logger } from '../infra/logger.js';
import type { EffectiveNotificationConfig } from '../domain/notification-config.js';
import { mergeMovementTypeAudiences, type MovementTypeAudiences } from '../domain/movement-type.js';
import type { MovementTypePolicy } from '../ports/movement-type-policy.port.js';
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

function buildRegistry(movements: RawMovement[], fail = false): SourceRegistry {
  const source: ProcessDataSource = {
    kind: 'fake',
    canHandle: () => true,
    fetch: async () => {
      if (fail) throw new Error('Consulta pública do TJAM indisponível (Request Rejected).');
      return { sourceKind: 'fake', collectedAt: new Date().toISOString(), movements };
    },
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
  registeredTypes: string[];
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
  /** Padrão do escritório por tipo; tipo ausente = avisa todos. */
  spaceTypes?: Record<string, MovementTypeAudiences>;
  processTypes?: Record<string, MovementTypeAudiences>;
  /** Movimentações já gravadas antes desta consulta. */
  stored?: StoredMovement[];
  /** Movimentações com aviso que falhou e ainda pode ser reenviado. */
  retryableIds?: string[];
  /** Fonte fora do ar / bloqueada. */
  failFetch?: boolean;
}): Harness {
  const recipients = options.recipients ?? [
    { type: 'responsible', phone: '+5592900000001', recipientId: 'profile-1' },
    { type: 'client', phone: '+5592900000002', recipientId: 'client-1' },
  ];

  const registry = buildRegistry(options.movements ?? [NEW_MOVEMENT], options.failFetch);

  const processRepository: ProcessRepository = {
    listTrackableProcesses: async () => [PROCESS],
    findTrackableProcessById: async () => PROCESS,
    updateTrackingState: async () => {},
    listCheckRequestedIds: async () => [],
    clearCheckRequest: async () => {},
  };

  let storedIdSeq = 0;
  const movementRepository: MovementRepository = {
    getByIds: async (_processId, ids) => (options.stored ?? []).filter((m) => ids.includes(m.id)),
    listKnownHashes: async () => new Set((options.stored ?? []).map((m) => m.contentHash)),
    insertNewMovements: async (_processId, _spaceId, movements) =>
      movements.map((m): StoredMovement => ({
        id: `stored-${++storedIdSeq}`,
        contentHash: m.contentHash,
        description: m.description,
        occurredAt: m.occurredAt,
        movementType: m.movementType,
      })),
  };

  const registeredTypes: string[] = [];
  const movementTypePolicy: MovementTypePolicy = {
    registerTypes: async (_spaceId, types) => {
      registeredTypes.push(...types);
    },
    resolve: async () =>
      mergeMovementTypeAudiences(
        new Map(Object.entries(options.spaceTypes ?? {})),
        new Map(Object.entries(options.processTypes ?? {})),
      ),
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
    listRetryableMovementIds: async () => options.retryableIds ?? [],
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
    movementTypePolicy,
    new GeneralMovementTemplate(),
    buildLogger(),
  );

  return { useCase, notifier, notificationLog, recipients, registeredTypes };
}

describe('TrackProcessUseCase — motor de notificações', () => {
  it('1ª sincronização (lastStateHash null) também avisa (N4)', async () => {
    const { useCase, notifier } = buildHarness({});
    const firstSyncProcess: TrackableProcess = { ...PROCESS, lastStateHash: null };
    const result = await useCase.execute(firstSyncProcess);
    expect(result.notificationsSent).toBe(2);
    expect(notifier.sendText).toHaveBeenCalledTimes(2);
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

  describe('reenvio de avisos que falharam (N7)', () => {
    const OLD: StoredMovement = {
      id: 'stored-old',
      contentHash: 'hash-old',
      description: 'ALVARÁ ENVIADO\nAlvará número 1',
      occurredAt: '2026-09-08T14:41:19.000Z',
      movementType: 'ALVARÁ ENVIADO',
    };

    it('consulta sem movimentação nova ainda reenvia o aviso que falhou', async () => {
      const { useCase, notifier } = buildHarness({
        movements: [],
        stored: [OLD],
        retryableIds: [OLD.id],
        recipients: [{ type: 'responsible', phone: '+5592900000001', recipientId: 'profile-1' }],
      });
      const result = await useCase.execute(PROCESS);
      expect(result.newMovementsCount).toBe(0);
      expect(result.notificationsSent).toBe(1);
      expect(String(notifier.sendText.mock.calls[0][2])).toContain('ALVARÁ ENVIADO');
    });

    it('tribunal fora do ar: a consulta falha, mas o aviso pendente sai mesmo assim', async () => {
      const { useCase, notifier } = buildHarness({
        failFetch: true,
        stored: [OLD],
        retryableIds: [OLD.id],
        recipients: [{ type: 'responsible', phone: '+5592900000001', recipientId: 'profile-1' }],
      });
      await expect(useCase.execute(PROCESS)).rejects.toThrow('Request Rejected');
      expect(notifier.sendText).toHaveBeenCalledTimes(1);
    });

    it('reenvio respeita o filtro de tipo vigente', async () => {
      const { useCase, notifier } = buildHarness({
        movements: [],
        stored: [OLD],
        retryableIds: [OLD.id],
        processTypes: { 'ALVARÁ ENVIADO': { responsible: false, client: false } },
      });
      await useCase.execute(PROCESS);
      expect(notifier.sendText).not.toHaveBeenCalled();
    });
  });

  describe('filtro por tipo de movimentação (N5/N6)', () => {
    const mov = (seq: number, title: string, at: string): RawMovement => ({
      sourceKind: 'fake',
      sourceMovementId: `1:${seq}`,
      occurredAt: at,
      title,
      description: title,
      raw: {},
    });
    const HISTORY = [
      mov(70, 'ALVARÁ ENVIADO', '2026-09-08T14:41:19.000Z'),
      mov(69, 'EXPEDIÇÃO DE INTIMAÇÃO', '2026-09-03T15:51:37.000Z'),
      mov(67, 'DECISÃO INTERLOCUTÓRIA', '2026-09-03T15:51:36.000Z'),
      mov(64, 'DECORRIDO PRAZO DE FULANO DE TAL', '2026-09-01T04:45:23.000Z'),
      mov(58, 'ALVARÁ ENVIADO', '2026-07-29T18:13:32.000Z'),
    ];
    const ON: MovementTypeAudiences = { responsible: true, client: true };
    const OFF: MovementTypeAudiences = { responsible: false, client: false };
    const onlyResponsible: NotificationRecipient[] = [
      { type: 'responsible', phone: '+5592900000001', recipientId: 'profile-1' },
    ];

    it('processo personalizado: só os tipos ligados, numa mensagem, em ordem cronológica', async () => {
      const { useCase, notifier, notificationLog } = buildHarness({
        movements: HISTORY,
        recipients: onlyResponsible,
        processTypes: {
          'ALVARÁ ENVIADO': ON,
          'EXPEDIÇÃO DE INTIMAÇÃO': ON,
          'DECISÃO INTERLOCUTÓRIA': OFF,
          'DECORRIDO PRAZO': OFF,
        },
      });
      const result = await useCase.execute({ ...PROCESS, lastStateHash: null });

      expect(result.notificationsSent).toBe(3); // 3 movimentações avisadas…
      expect(notifier.sendText).toHaveBeenCalledTimes(1); // …numa mensagem só (anti-bloqueio)
      const text = String(notifier.sendText.mock.calls[0][2]);
      expect(text).toContain('3 movimentações');
      const order = [
        '29/07/2026 — ALVARÁ ENVIADO',
        '03/09/2026 — EXPEDIÇÃO DE INTIMAÇÃO',
        '08/09/2026 — ALVARÁ ENVIADO',
      ];
      const positions = order.map((o) => text.indexOf(o));
      expect(positions.every((p) => p >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      expect(text).not.toContain('DECISÃO INTERLOCUTÓRIA');
      expect(notificationLog.recordSent).toHaveBeenCalledTimes(3); // registro segue por movimentação
    });

    it('muitas movimentações: divide em poucas mensagens (máx. 10 por mensagem)', async () => {
      const many = Array.from({ length: 23 }, (_, i) =>
        mov(i + 1, 'EXPEDIÇÃO DE INTIMAÇÃO', new Date(Date.UTC(2026, 0, i + 1)).toISOString()),
      );
      const { useCase, notifier } = buildHarness({ movements: many, recipients: onlyResponsible });
      const result = await useCase.execute({ ...PROCESS, lastStateHash: null });
      expect(result.notificationsSent).toBe(23);
      expect(notifier.sendText).toHaveBeenCalledTimes(3);
    });

    it('o que o processo personalizou vence o padrão do escritório; o resto segue o padrão', async () => {
      const { useCase, notifier } = buildHarness({
        movements: HISTORY,
        recipients: onlyResponsible,
        spaceTypes: {
          'ALVARÁ ENVIADO': OFF,
          'EXPEDIÇÃO DE INTIMAÇÃO': OFF,
          'DECISÃO INTERLOCUTÓRIA': OFF,
        },
        processTypes: { 'EXPEDIÇÃO DE INTIMAÇÃO': ON },
      });
      const result = await useCase.execute(PROCESS);
      const text = String(notifier.sendText.mock.calls[0][2]);
      // INTIMAÇÃO (o processo ligou) + DECORRIDO PRAZO (fora da lista = avisa)
      expect(result.notificationsSent).toBe(2);
      expect(text).toContain('EXPEDIÇÃO DE INTIMAÇÃO');
      expect(text).toContain('DECORRIDO PRAZO');
      expect(text).not.toContain('ALVARÁ ENVIADO');
    });

    it('toggles separados: tipo desligado para responsável ainda vai para o cliente', async () => {
      const { useCase, notifier } = buildHarness({
        movements: [HISTORY[2]],
        spaceTypes: { 'DECISÃO INTERLOCUTÓRIA': { responsible: false, client: true } },
      });
      await useCase.execute(PROCESS);
      expect(notifier.sendText).toHaveBeenCalledTimes(1);
      expect(notifier.sendText).toHaveBeenCalledWith(
        PROCESS.spaceId,
        '+5592900000002',
        expect.any(String),
      );
    });

    it('registra na lista do escritório o tipo normalizado, sem nome de parte', async () => {
      const { useCase, registeredTypes } = buildHarness({ movements: HISTORY, recipients: [] });
      await useCase.execute(PROCESS);
      expect(registeredTypes).toContain('DECORRIDO PRAZO');
      expect(registeredTypes.some((t) => t.includes('FULANO'))).toBe(false);
    });
  });
});
