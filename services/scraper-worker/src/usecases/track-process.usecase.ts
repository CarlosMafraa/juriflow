import type { RawMovement, SourceRegistry } from '@juriflow/collectors-core';
import type { Logger } from '../infra/logger.js';
import { computeMovementContentHash, computeStateHash } from '../domain/hashing.js';
import {
  chunkForDigest,
  PlaceholderMovementTemplate,
  type MessageTemplate,
} from '../domain/message-template.js';
import { normalizeMovementType } from '../domain/movement-type.js';
import type { NotificationConfigResolver } from '../ports/notification-config.port.js';
import type { NotificationLog } from '../ports/notification-log.port.js';
import type { Notifier } from '../ports/notifier.port.js';
import type {
  MovementRepository,
  MovementToInsert,
  StoredMovement,
} from '../ports/movement-repository.port.js';
import type { MovementTypePolicy } from '../ports/movement-type-policy.port.js';
import type { ProcessRepository, TrackableProcess } from '../ports/process-repository.port.js';
import type { RecipientResolver } from '../ports/recipient-resolver.port.js';
import type { TemplateRepository } from '../ports/template-repository.port.js';

export interface TrackProcessResult {
  readonly processId: string;
  readonly newMovementsCount: number;
  readonly notificationsSent: number;
  readonly notificationsFailed: number;
}

/** Tentativas de um aviso antes de desistir (N7). */
export const MAX_DELIVERY_ATTEMPTS = 5;

/**
 * Orquestrador único do pipeline (RN seção 21):
 *   fonte → normaliza (hash + tipo) → histórico → detector de mudança →
 *   config de notificação + filtro por tipo → destinatários → template →
 *   notifica → estado.
 *
 * Regras (docs/REGRAS-DE-NEGOCIO.md):
 *   - N4: a 1ª sincronização TAMBÉM avisa — tudo o que passar no filtro,
 *     AGRUPADO numa mensagem por destinatário (dividida só se ficar grande),
 *     da mais antiga para a mais nova. O registro de envio (por movimentação
 *     e destinatário) garante que depois só vai o que é novo. O ritmo entre
 *     mensagens e o "digitando…" ficam no Notifier (anti-bloqueio do WhatsApp).
 *   - N5/N6: cada tipo de movimentação avisa responsáveis e/ou clientes
 *     conforme o padrão do escritório ou a personalização do processo.
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
    /** Fallback quando espaço/processo não têm template próprio configurado. */
    private readonly defaultTemplate: MessageTemplate,
    private readonly logger: Logger,
  ) {}

  async execute(process: TrackableProcess): Promise<TrackProcessResult> {
    const isFirstSync = process.lastStateHash === null;

    try {
      const movements = await this.collect(process);
      const { insertedMovements, allKnownHashes } = await this.persist(process, movements);

      let sent = 0;
      let failed = 0;
      const retries = await this.failedDeliveriesToRetry(process, insertedMovements);
      const toNotify = [...retries, ...insertedMovements];
      if (toNotify.length > 0) {
        if (isFirstSync) {
          this.logger.info('1ª sincronização do processo — avisando o histórico filtrado (N4).', {
            processId: process.id,
            movementsFound: movements.length,
          });
        }
        if (retries.length > 0) {
          this.logger.info('Reenviando avisos que falharam (N7).', {
            processId: process.id,
            movements: retries.length,
          });
        }
        const outcome = await this.notifyAboutNewMovements(process, toNotify);
        sent = outcome.sent;
        failed = outcome.failed;
      }

      await this.processRepository.updateTrackingState(process.id, {
        lastStateHash: computeStateHash(allKnownHashes),
        lastCheckedAt: new Date(),
        lastCheckError: null,
      });

      return {
        processId: process.id,
        newMovementsCount: insertedMovements.length,
        notificationsSent: sent,
        notificationsFailed: failed,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao acompanhar processo.', { processId: process.id, error: message });
      await this.processRepository.updateTrackingState(process.id, {
        lastStateHash: process.lastStateHash ?? computeStateHash([]),
        lastCheckedAt: new Date(),
        lastCheckError: message,
      });
      // O reenvio (N7) não depende do tribunal: sai mesmo com a consulta falhando.
      await this.retryFailedDeliveriesOnly(process);
      throw error;
    }
  }

  private async retryFailedDeliveriesOnly(process: TrackableProcess): Promise<void> {
    try {
      const retries = await this.failedDeliveriesToRetry(process, []);
      if (retries.length === 0) return;
      this.logger.info('Consulta falhou; reenviando mesmo assim os avisos pendentes (N7).', {
        processId: process.id,
        movements: retries.length,
      });
      await this.notifyAboutNewMovements(process, retries);
    } catch (error) {
      this.logger.error('Falha ao reenviar avisos pendentes.', {
        processId: process.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
  ): Promise<{ insertedMovements: readonly StoredMovement[]; allKnownHashes: readonly string[] }> {
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
      insertedMovements: chronological(inserted, prepared),
      allKnownHashes: [...known, ...inserted.map((m) => m.contentHash)],
    };
  }

  /** Movimentações antigas com aviso que falhou e ainda cabe nova tentativa (N7). */
  private async failedDeliveriesToRetry(
    process: TrackableProcess,
    insertedMovements: readonly StoredMovement[],
  ): Promise<StoredMovement[]> {
    const justInserted = new Set(insertedMovements.map((m) => m.id));
    const ids = (
      await this.notificationLog.listRetryableMovementIds(process.id, MAX_DELIVERY_ATTEMPTS)
    ).filter((id) => !justInserted.has(id));
    const movements = await this.movementRepository.getByIds(process.id, ids);
    return movements.sort(
      (a, b) =>
        (a.occurredAt ? Date.parse(a.occurredAt) : 0) -
        (b.occurredAt ? Date.parse(b.occurredAt) : 0),
    );
  }

  private async notifyAboutNewMovements(
    process: TrackableProcess,
    insertedMovements: readonly StoredMovement[],
  ): Promise<{ sent: number; failed: number }> {
    const config = await this.notificationConfigResolver.resolve(process.id, process.spaceId);

    const allRecipients = await this.recipientResolver.resolveRecipients(process.id);
    const recipients = allRecipients.filter((r) =>
      r.type === 'responsible' ? config.notifyResponsible : config.notifyClients,
    );
    if (recipients.length === 0) return { sent: 0, failed: 0 };

    const audiencesFor = await this.movementTypePolicy.resolve(process.id, process.spaceId);
    const responsibleTemplate = await this.resolveTemplate(config.responsibleTemplateId);
    const clientTemplate = await this.resolveTemplate(config.clientTemplateId);

    let sent = 0;
    let failed = 0;
    for (const recipient of recipients) {
      const pending: StoredMovement[] = [];
      for (const movement of insertedMovements) {
        const audiences = audiencesFor(movement.movementType);
        if (recipient.type === 'responsible' ? !audiences.responsible : !audiences.client) continue;
        const alreadySent = await this.notificationLog.wasAlreadySent(
          movement.id,
          recipient.type,
          recipient.recipientId,
        );
        if (!alreadySent) pending.push(movement);
      }

      const template = recipient.type === 'responsible' ? responsibleTemplate : clientTemplate;
      for (const group of chunkForDigest(pending)) {
        const message = template.renderDigest({ cnjNumber: process.cnjNumber, movements: group });
        const delivery = {
          spaceId: process.spaceId,
          processId: process.id,
          recipientType: recipient.type,
          recipientId: recipient.recipientId,
          phone: recipient.phone,
        };
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
    }
    return { sent, failed };
  }

  private async resolveTemplate(templateId: string | null): Promise<MessageTemplate> {
    if (!templateId) return this.defaultTemplate;
    const body = await this.templateRepository.getBodyById(templateId);
    return body ? new PlaceholderMovementTemplate(body) : this.defaultTemplate;
  }
}

/**
 * Da mais antiga para a mais nova. Empate de data (várias movimentações no
 * mesmo segundo) segue a ordem inversa da fonte, que lista a mais nova primeiro.
 */
function chronological(
  inserted: readonly StoredMovement[],
  sourceOrder: readonly MovementToInsert[],
): StoredMovement[] {
  const position = new Map(sourceOrder.map((m, i) => [m.contentHash, i]));
  return [...inserted].sort((a, b) => {
    const ta = a.occurredAt ? Date.parse(a.occurredAt) : 0;
    const tb = b.occurredAt ? Date.parse(b.occurredAt) : 0;
    if (ta !== tb) return ta - tb;
    return (position.get(b.contentHash) ?? 0) - (position.get(a.contentHash) ?? 0);
  });
}
