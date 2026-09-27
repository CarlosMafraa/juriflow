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
import type { DeliveryRecord, NotificationLog } from '../ports/notification-log.port.js';
import type { Notifier } from '../ports/notifier.port.js';
import type { MovementRepository, StoredMovement } from '../ports/movement-repository.port.js';
import type { ProcessRepository, TrackableProcess } from '../ports/process-repository.port.js';
import type { NotificationRecipient, RecipientResolver } from '../ports/recipient-resolver.port.js';
import type { TemplateRepository } from '../ports/template-repository.port.js';
import { MAX_DELIVERY_ATTEMPTS, TrackProcessUseCase } from './track-process.usecase.js';

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
  messagingChannel: { isConnected: ReturnType<typeof vi.fn> };
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
  /** Registros de envio já existentes (entregues ou com falha). */
  deliveries?: DeliveryRecord[];
  /** WhatsApp do espaço conectado? Padrão: sim. */
  channelConnected?: boolean;
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
    findNotifiableProcessById: async () => null,
    clearSyncBaseline: vi.fn(async () => {}),
    updateTrackingState: async () => {},
    listCheckRequestedIds: async () => [],
    clearCheckRequest: async () => {},
  };

  let storedIdSeq = 0;
  const store: StoredMovement[] = [...(options.stored ?? [])];
  const movementRepository: MovementRepository = {
    listKnownHashes: async () => new Set(store.map((m) => m.contentHash)),
    // Mesma ordem do banco: pela data da movimentação.
    listByProcess: async () =>
      [...store].sort(
        (a, b) =>
          (a.occurredAt ? Date.parse(a.occurredAt) : 0) -
          (b.occurredAt ? Date.parse(b.occurredAt) : 0),
      ),
    insertNewMovements: async (_processId, _spaceId, movements) => {
      const inserted = movements.map((m): StoredMovement => ({
        id: `stored-${++storedIdSeq}`,
        contentHash: m.contentHash,
        description: m.description,
        occurredAt: m.occurredAt,
        movementType: m.movementType,
      }));
      store.push(...inserted);
      return inserted;
    },
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

  const skipped: DeliveryRecord[] = [];
  const notificationLog: NotificationLog = {
    listDeliveries: async () =>
      options.alreadySent
        ? store.flatMap((m) =>
            recipients.map((r): DeliveryRecord => ({
              movementId: m.id,
              recipientType: r.type,
              recipientId: r.recipientId,
              status: 'sent',
              attempts: 1,
            })),
          )
        : [...(options.deliveries ?? []), ...skipped],
    recordSent: vi.fn(async () => {}),
    recordFailed: vi.fn(async () => {}),
    // Como no banco: o "já informado" gravado volta na próxima leitura.
    recordSkipped: vi.fn(async (input) => {
      skipped.push({
        movementId: input.movementId,
        recipientType: input.recipientType,
        recipientId: input.recipientId,
        status: 'skipped',
        attempts: 1,
      });
    }),
  };
  const messagingChannel = { isConnected: vi.fn(async () => options.channelConnected ?? true) };

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
    messagingChannel,
    new GeneralMovementTemplate(),
    buildLogger(),
  );

  return { useCase, notifier, notificationLog, recipients, registeredTypes, messagingChannel };
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

  const OLD: StoredMovement = {
    id: 'stored-old',
    contentHash: 'hash-old',
    description: 'ALVARÁ ENVIADO\nAlvará número 1',
    occurredAt: '2026-09-08T14:41:19.000Z',
    movementType: 'ALVARÁ ENVIADO',
  };
  const failedFor = (
    movementId: string,
    recipientId: string,
    attempts: number,
  ): DeliveryRecord => ({
    movementId,
    recipientType: 'responsible',
    recipientId,
    status: 'failed',
    attempts,
  });
  const sentFor = (movementId: string, recipientId: string): DeliveryRecord => ({
    movementId,
    recipientType: 'responsible',
    recipientId,
    status: 'sent',
    attempts: 1,
  });

  describe('reenvio de avisos que falharam (N7)', () => {
    it('consulta sem movimentação nova ainda reenvia o aviso que falhou', async () => {
      const { useCase, notifier } = buildHarness({
        movements: [],
        stored: [OLD],
        deliveries: [failedFor(OLD.id, 'profile-1', 1)],
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
        deliveries: [failedFor(OLD.id, 'profile-1', 2)],
        recipients: [{ type: 'responsible', phone: '+5592900000001', recipientId: 'profile-1' }],
      });
      await expect(useCase.execute(PROCESS)).rejects.toThrow('Request Rejected');
      expect(notifier.sendText).toHaveBeenCalledTimes(1);
    });

    it('reenvio respeita o filtro de tipo vigente', async () => {
      const { useCase, notifier } = buildHarness({
        movements: [],
        stored: [OLD],
        deliveries: [failedFor(OLD.id, 'profile-1', 1)],
        processTypes: { 'ALVARÁ ENVIADO': { responsible: false, client: false } },
      });
      await useCase.execute(PROCESS);
      expect(notifier.sendText).not.toHaveBeenCalled();
    });

    it('desiste depois do limite de tentativas', async () => {
      const { useCase, notifier } = buildHarness({
        movements: [],
        stored: [OLD],
        deliveries: [failedFor(OLD.id, 'profile-1', MAX_DELIVERY_ATTEMPTS)],
        recipients: [{ type: 'responsible', phone: '+5592900000001', recipientId: 'profile-1' }],
      });
      await useCase.execute(PROCESS);
      expect(notifier.sendText).not.toHaveBeenCalled();
    });
  });

  describe('avisos pendentes (N10/N11)', () => {
    const OLDER: StoredMovement = {
      id: 'stored-older',
      contentHash: 'hash-older',
      description: 'EXPEDIÇÃO DE INTIMAÇÃO',
      occurredAt: '2026-08-01T10:00:00.000Z',
      movementType: 'EXPEDIÇÃO DE INTIMAÇÃO',
    };
    const veteran: NotificationRecipient = {
      type: 'responsible',
      phone: '+5592900000001',
      recipientId: 'profile-1',
    };
    const newcomer: NotificationRecipient = {
      type: 'responsible',
      phone: '+5592900000009',
      recipientId: 'profile-2',
    };

    it('responsável incluído depois recebe o histórico numa mensagem; quem já recebeu, nada', async () => {
      const { useCase, notifier, notificationLog } = buildHarness({
        movements: [],
        stored: [OLD, OLDER],
        recipients: [veteran, newcomer],
        deliveries: [sentFor(OLD.id, 'profile-1'), sentFor(OLDER.id, 'profile-1')],
      });
      const outcome = await useCase.notifyPending(PROCESS);

      expect(outcome).toEqual({ sent: 2, failed: 0, channelOffline: false });
      expect(notifier.sendText).toHaveBeenCalledTimes(1);
      const [, phone, text] = notifier.sendText.mock.calls[0] as [string, string, string];
      expect(phone).toBe(newcomer.phone);
      expect(text).toContain('2 movimentações');
      expect(text.indexOf('INTIMAÇÃO')).toBeLessThan(text.indexOf('ALVARÁ'));
      expect(notificationLog.recordSent).toHaveBeenCalledTimes(2);
    });

    it('configuração mudada vale para o que ficou para trás (clientes ligados depois)', async () => {
      const { useCase, notifier } = buildHarness({
        movements: [],
        stored: [OLD],
        deliveries: [sentFor(OLD.id, 'profile-1')], // na época, só o responsável era avisado
      });
      await useCase.notifyPending(PROCESS);
      expect(notifier.sendText).toHaveBeenCalledTimes(1);
      expect(notifier.sendText).toHaveBeenCalledWith(
        PROCESS.spaceId,
        '+5592900000002',
        expect.stringContaining('ALVARÁ ENVIADO'),
      );
    });

    it('WhatsApp desconectado: nada é tentado nem registrado como falha — fica pendente', async () => {
      const { useCase, notifier, notificationLog } = buildHarness({ channelConnected: false });
      const result = await useCase.execute(PROCESS);

      expect(result.newMovementsCount).toBe(1);
      expect(result.notificationsSent).toBe(0);
      expect(result.notificationsFailed).toBe(0);
      expect(notifier.sendText).not.toHaveBeenCalled();
      expect(notificationLog.recordFailed).not.toHaveBeenCalled();
      expect(await useCase.notifyPending(PROCESS)).toEqual({
        sent: 0,
        failed: 0,
        channelOffline: true,
      });
    });

    it('sem nada pendente, nem pergunta pelo WhatsApp', async () => {
      const { useCase, messagingChannel } = buildHarness({ alreadySent: true });
      await useCase.execute(PROCESS);
      expect(messagingChannel.isConnected).not.toHaveBeenCalled();
    });
  });

  describe('1ª sincronização de processo que tinha movimentações manuais (N13)', () => {
    it('registra o histórico do tribunal como já informado, sem mensagem', async () => {
      const { useCase, notifier, notificationLog } = buildHarness({});
      const result = await useCase.execute({
        ...PROCESS,
        lastStateHash: null,
        syncBaselinePending: true,
      });

      expect(result.newMovementsCount).toBe(1);
      expect(result.notificationsSent).toBe(0);
      expect(notifier.sendText).not.toHaveBeenCalled();
      expect(notificationLog.recordSkipped).toHaveBeenCalledTimes(2); // responsável + cliente
    });

    it('já informado não volta como pendente', async () => {
      const { useCase, notifier } = buildHarness({
        movements: [],
        stored: [OLD],
        deliveries: [
          {
            movementId: OLD.id,
            recipientType: 'responsible',
            recipientId: 'profile-1',
            status: 'skipped',
            attempts: 1,
          },
          {
            movementId: OLD.id,
            recipientType: 'client',
            recipientId: 'client-1',
            status: 'skipped',
            attempts: 1,
          },
        ],
      });
      await useCase.execute(PROCESS);
      expect(notifier.sendText).not.toHaveBeenCalled();
    });

    it('tribunal fora do ar na 1ª sincronização: nada é enviado (sem baseline, sem aviso)', async () => {
      const { useCase, notifier, notificationLog } = buildHarness({
        failFetch: true,
        stored: [OLD],
      });
      await expect(
        useCase.execute({ ...PROCESS, lastStateHash: null, syncBaselinePending: true }),
      ).rejects.toThrow('Request Rejected');
      expect(notifier.sendText).not.toHaveBeenCalled();
      expect(notificationLog.recordSkipped).not.toHaveBeenCalled();
    });
  });

  describe('processo manual (sem sincronização)', () => {
    it('avisa as movimentações manuais, com a referência interna quando não há CNJ', async () => {
      const MANUAL: StoredMovement = {
        id: 'manual-1',
        contentHash: 'manual:x',
        description: 'Audiência realizada',
        occurredAt: '2026-09-25T16:00:00.000Z',
        movementType: null,
      };
      const { useCase, notifier } = buildHarness({ movements: [], stored: [MANUAL] });
      const outcome = await useCase.notifyPending({
        id: PROCESS.id,
        spaceId: PROCESS.spaceId,
        reference: 'REF-123',
        mode: 'manual',
      });
      expect(outcome.sent).toBe(2);
      expect(notifier.sendText).toHaveBeenCalledWith(
        PROCESS.spaceId,
        '+5592900000002',
        expect.stringContaining('REF-123'),
      );
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
