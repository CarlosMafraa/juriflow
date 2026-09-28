import type { RawMovement, SourceRegistry } from '@juriflow/collectors-core';
import type { Logger } from '../infra/logger.js';
import { computeMovementContentHash, computeStateHash } from '../domain/hashing.js';
import {
  chunkForDigest,
  PlaceholderMovementTemplate,
  type MessageTemplate,
} from '../domain/message-template.js';
import { normalizeMovementType } from '../domain/movement-type.js';
import type { EffectiveNotificationConfig } from '../domain/notification-config.js';
import type { MessagingChannel } from '../ports/messaging-channel.port.js';
import type { NotificationConfigResolver } from '../ports/notification-config.port.js';
import type { DeliveryRecord, NotificationLog } from '../ports/notification-log.port.js';
import type { Notifier } from '../ports/notifier.port.js';
import type {
  MovementRepository,
  MovementToInsert,
  StoredMovement,
} from '../ports/movement-repository.port.js';
import type { MovementTypePolicy } from '../ports/movement-type-policy.port.js';
import {
  asNotifiable,
  type NotifiableProcess,
  type ProcessRepository,
  type TrackableProcess,
} from '../ports/process-repository.port.js';
import type {
  NotificationRecipient,
  RecipientResolver,
  RecipientType,
} from '../ports/recipient-resolver.port.js';
import type { TemplateRepository } from '../ports/template-repository.port.js';

export interface TrackProcessResult {
  readonly processId: string;
  readonly newMovementsCount: number;
  readonly notificationsSent: number;
  readonly notificationsFailed: number;
}

export interface NotifyOutcome {
  readonly sent: number;
  readonly failed: number;
  /** true = WhatsApp do espaço desconectado: nada foi tentado, tudo segue pendente. */
  readonly channelOffline: boolean;
}

/** Tentativas de um aviso antes de desistir (N7). */
export const MAX_DELIVERY_ATTEMPTS = 5;

const NOTHING_TO_DO: NotifyOutcome = { sent: 0, failed: 0, channelOffline: false };

/**
 * Orquestrador único do pipeline (RN seção 21):
 *   fonte → normaliza (hash + tipo) → histórico → detector de mudança →
 *   config de notificação + filtro por tipo → destinatários → template →
 *   notifica → estado.
 *
 * Regras (docs/REGRAS-DE-NEGOCIO.md):
 *   - N4: a 1ª sincronização TAMBÉM avisa — tudo o que passar no filtro,
 *     AGRUPADO numa mensagem por destinatário (dividida só se ficar grande),
 *     da mais antiga para a mais nova. O ritmo entre mensagens e o
 *     "digitando…" ficam no Notifier (anti-bloqueio do WhatsApp).
 *   - N5/N6: cada tipo de movimentação avisa responsáveis e/ou clientes
 *     conforme o padrão do escritório ou a personalização do processo.
 *   - N7: aviso que falhou é tentado de novo, até MAX_DELIVERY_ATTEMPTS.
 *   - N10: cada destinatário recebe TUDO o que ainda não recebeu e que a
 *     configuração vigente manda avisar, não só o que a consulta trouxe de
 *     novo. Quem entra depois no processo recebe o histórico; configuração
 *     mudada vale para o que ficou para trás. O registro de envio (por
 *     movimentação e destinatário) impede mandar a mesma coisa duas vezes.
 *   - N11: com o WhatsApp do espaço desconectado nada é tentado — fica
 *     pendente, sem gastar tentativas, e sai quando conectar.
 *
 * Depende só de portas (SourceRegistry do collectors-core + as ports locais).
 * Nenhuma classe aqui sabe o que é Postgres, Playwright ou WAHA — isso é
 * decidido por quem instancia esta classe (ver src/main.ts).
 */
export class TrackProcessUseCase {
  constructor(
    private readonly sourceRegistry: SourceRegistry,
    private readonly processRepository: ProcessRepository,
    private readonly movementRepository: MovementRepository,
    private readonly recipientResolver: RecipientResolver,
    private readonly notificationConfigResolver: NotificationConfigResolver,
    private readonly templateRepository: TemplateRepository,
    private readonly notifier: Notifier,
    private readonly notificationLog: NotificationLog,
    private readonly movementTypePolicy: MovementTypePolicy,
    private readonly messagingChannel: MessagingChannel,
    /** Fallback quando espaço/processo não têm template próprio configurado. */
    private readonly defaultTemplate: MessageTemplate,
    private readonly logger: Logger,
  ) {}

  async execute(process: TrackableProcess): Promise<TrackProcessResult> {
    const isFirstSync = process.lastStateHash === null;

    try {
      const movements = await this.collect(process);
      const { insertedCount, allKnownHashes } = await this.persist(process, movements);

      if (process.syncBaselinePending) {
        await this.registerBaseline(process);
      } else if (isFirstSync && insertedCount > 0) {
        this.logger.info('1ª sincronização do processo — avisando o histórico filtrado (N4).', {
          processId: process.id,
          movementsFound: movements.length,
        });
      }
      const outcome = await this.notifyPending(asNotifiable(process));

      await this.processRepository.updateTrackingState(process.id, {
        lastStateHash: computeStateHash(allKnownHashes),
        lastCheckedAt: new Date(),
        lastCheckError: null,
      });

      return {
        processId: process.id,
        newMovementsCount: insertedCount,
        notificationsSent: outcome.sent,
        notificationsFailed: outcome.failed,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao acompanhar processo.', { processId: process.id, error: message });
      await this.processRepository.updateTrackingState(process.id, {
        lastStateHash: process.lastStateHash ?? computeStateHash([]),
        lastCheckedAt: new Date(),
        lastCheckError: message,
      });
      // Os avisos pendentes não dependem do tribunal: saem mesmo com a consulta falhando.
      // (Menos na 1ª sincronização sem histórico: sem a coleta, não há baseline.)
      if (process.syncBaselinePending) throw error;
      await this.notifyPending(asNotifiable(process)).catch((notifyError) =>
        this.logger.error('Falha ao enviar avisos pendentes.', {
          processId: process.id,
          error: notifyError instanceof Error ? notifyError.message : String(notifyError),
        }),
      );
      throw error;
    }
  }

  /**
   * Envia a cada destinatário o que ele ainda não recebeu (N7/N10), sem
   * consultar o tribunal. Roda ao fim de cada consulta e pela fila de avisos
   * pendentes (configuração mudou, entrou destinatário, WhatsApp conectou).
   */
  async notifyPending(process: NotifiableProcess): Promise<NotifyOutcome> {
    const { config, work } = await this.pendingWork(process);
    if (work.length === 0) return NOTHING_TO_DO;

    if (!(await this.messagingChannel.isConnected(process.spaceId))) {
      this.logger.warn('WhatsApp do espaço desconectado — avisos ficam pendentes (N11).', {
        processId: process.id,
        spaceId: process.spaceId,
        pendingRecipients: work.length,
      });
      return { sent: 0, failed: 0, channelOffline: true };
    }

    const responsibleTemplate = await this.resolveTemplate(config.responsibleTemplateId);
    const clientTemplate = await this.resolveTemplate(config.clientTemplateId);

    let sent = 0;
    let failed = 0;
    for (const { recipient, pending } of work) {
      const template = recipient.type === 'responsible' ? responsibleTemplate : clientTemplate;
      const outcome = await this.deliver(process, recipient, template, pending);
      sent += outcome.sent;
      failed += outcome.failed;
    }
    return { sent, failed, channelOffline: false };
  }

  /**
   * O que falta avisar, por destinatário, na fonte que vale agora (manual ou
   * tribunal): o que a configuração manda e ainda não foi entregue/registrado.
   */
  private async pendingWork(process: NotifiableProcess): Promise<{
    config: EffectiveNotificationConfig;
    work: { recipient: NotificationRecipient; pending: StoredMovement[] }[];
  }> {
    const config = await this.notificationConfigResolver.resolve(process.id, process.spaceId);
    const recipients = (await this.recipientResolver.resolveRecipients(process.id)).filter((r) =>
      r.type === 'responsible' ? config.notifyResponsible : config.notifyClients,
    );
    if (recipients.length === 0) return { config, work: [] };

    const [movements, deliveries, audiencesFor] = await Promise.all([
      this.movementRepository.listByProcess(process.id, process.mode),
      this.notificationLog.listDeliveries(process.id),
      this.movementTypePolicy.resolve(process.id, process.spaceId),
    ]);
    const settled = settledDeliveries(deliveries);

    const work = recipients
      .map((recipient) => ({
        recipient,
        pending: movements.filter((movement) => {
          const audiences = audiencesFor(movement.movementType);
          const wanted =
            recipient.type === 'responsible' ? audiences.responsible : audiences.client;
          return (
            wanted && !settled.has(deliveryKey(movement.id, recipient.type, recipient.recipientId))
          );
        }),
      }))
      .filter((w) => w.pending.length > 0);
    return { config, work };
  }

  /**
   * 1ª sincronização de processo que tinha movimentações manuais (N13): quem
   * seria avisado já foi informado à mão — o histórico do tribunal é
   * registrado como "já informado", sem mensagem. Dali em diante, só o novo.
   */
  private async registerBaseline(process: TrackableProcess): Promise<void> {
    const { work } = await this.pendingWork(asNotifiable(process));
    for (const { recipient, pending } of work) {
      for (const m of pending)
        await this.notificationLog.recordSkipped({
          spaceId: process.spaceId,
          processId: process.id,
          movementId: m.id,
          recipientType: recipient.type,
          recipientId: recipient.recipientId,
          phone: recipient.phone,
        });
    }
    await this.processRepository.clearSyncBaseline(process.id);
    this.logger.info('1ª sincronização após movimentações manuais — histórico sem aviso (N13).', {
      processId: process.id,
      registeredRecipients: work.length,
    });
  }

  private async deliver(
    process: NotifiableProcess,
    recipient: NotificationRecipient,
    template: MessageTemplate,
    pending: readonly StoredMovement[],
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    const delivery = {
      spaceId: process.spaceId,
      processId: process.id,
      recipientType: recipient.type,
      recipientId: recipient.recipientId,
      phone: recipient.phone,
    };
    for (const group of chunkForDigest(pending)) {
      const message = template.renderDigest({ cnjNumber: process.reference, movements: group });
      try {
        await this.notifier.sendText(process.spaceId, recipient.phone, message);
        for (const m of group)
          await this.notificationLog.recordSent({ ...delivery, movementId: m.id });
        sent += group.length;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        for (const m of group)
          await this.notificationLog.recordFailed({
            ...delivery,
            movementId: m.id,
            error: errorMessage,
          });
        failed += group.length;
      }
    }
    return { sent, failed };
  }

  private async collect(process: TrackableProcess): Promise<readonly RawMovement[]> {
    const source = this.sourceRegistry.create(process.sourceKind);
    const target = { cnjNumber: process.cnjNumber, courtId: process.courtId };
    const result = await source.fetch({ target, requestId: process.id });
    return result.movements;
  }

  private async persist(
    process: TrackableProcess,
    movements: readonly RawMovement[],
  ): Promise<{ insertedCount: number; allKnownHashes: readonly string[] }> {
    const known = await this.movementRepository.listKnownHashes(process.id);
    const prepared: MovementToInsert[] = movements.map((m) => ({
      ...m,
      contentHash: computeMovementContentHash(m),
      movementType: normalizeMovementType(m.title),
    }));
    const unseen = prepared.filter((m) => !known.has(m.contentHash));

    const inserted =
      unseen.length > 0
        ? await this.movementRepository.insertNewMovements(process.id, process.spaceId, unseen)
        : [];

    const newTypes = inserted.map((m) => m.movementType).filter((t): t is string => t !== null);
    await this.movementTypePolicy.registerTypes(process.spaceId, newTypes);

    return {
      insertedCount: inserted.length,
      allKnownHashes: [...known, ...inserted.map((m) => m.contentHash)],
    };
  }

  private async resolveTemplate(templateId: string | null): Promise<MessageTemplate> {
    if (!templateId) return this.defaultTemplate;
    const body = await this.templateRepository.getBodyById(templateId);
    return body ? new PlaceholderMovementTemplate(body) : this.defaultTemplate;
  }
}

function deliveryKey(movementId: string, type: RecipientType, recipientId: string): string {
  return `${movementId}|${type}|${recipientId}`;
}

/** Entregue, já informado (N13) ou falhou vezes demais (N7): não entra mais como pendente. */
function settledDeliveries(deliveries: readonly DeliveryRecord[]): Set<string> {
  return new Set(
    deliveries
      .filter(
        (d) => d.status === 'sent' || d.status === 'skipped' || d.attempts >= MAX_DELIVERY_ATTEMPTS,
      )
      .map((d) => deliveryKey(d.movementId, d.recipientType, d.recipientId)),
  );
}
