import type { RawMovement, SourceRegistry } from '@juriflow/collectors-core';
import type { Logger } from '../infra/logger.js';
import { computeMovementContentHash, computeStateHash } from '../domain/hashing.js';
import type { MessageTemplate } from '../domain/message-template.js';
import type { NotificationLog } from '../ports/notification-log.port.js';
import type { Notifier } from '../ports/notifier.port.js';
import type { MovementRepository, StoredMovement } from '../ports/movement-repository.port.js';
import type { ProcessRepository, TrackableProcess } from '../ports/process-repository.port.js';
import type { RecipientResolver } from '../ports/recipient-resolver.port.js';

export interface TrackProcessResult {
  readonly processId: string;
  readonly newMovementsCount: number;
  readonly notificationsSent: number;
  readonly notificationsFailed: number;
}

/**
 * Orquestrador único do pipeline (RN seção 21):
 *   fonte → normaliza (hash) → histórico → detector de mudança → destinatários → notifica → estado.
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
    private readonly notifier: Notifier,
    private readonly notificationLog: NotificationLog,
    private readonly messageTemplate: MessageTemplate,
    private readonly logger: Logger,
  ) {}

  async execute(process: TrackableProcess): Promise<TrackProcessResult> {
    const isFirstSync = process.lastStateHash === null;

    try {
      const movements = await this.collect(process);
      const { insertedMovements, allKnownHashes } = await this.persist(process, movements);

      let sent = 0;
      let failed = 0;
      if (!isFirstSync && insertedMovements.length > 0) {
        const outcome = await this.notifyAboutNewMovements(process, insertedMovements);
        sent = outcome.sent;
        failed = outcome.failed;
      } else if (isFirstSync) {
        this.logger.info(
          '1ª coleta do processo — estado inicial registrado, sem notificação (RN11).',
          {
            processId: process.id,
            movementsFound: movements.length,
          },
        );
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
      throw error;
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
    const withHash = movements.map((m) => ({ ...m, contentHash: computeMovementContentHash(m) }));
    const unseen = withHash.filter((m) => !known.has(m.contentHash));

    const insertedMovements =
      unseen.length > 0
        ? await this.movementRepository.insertNewMovements(process.id, process.spaceId, unseen)
        : [];

    return {
      insertedMovements,
      allKnownHashes: [...known, ...insertedMovements.map((m) => m.contentHash)],
    };
  }

  private async notifyAboutNewMovements(
    process: TrackableProcess,
    insertedMovements: readonly StoredMovement[],
  ): Promise<{ sent: number; failed: number }> {
    const recipients = await this.recipientResolver.resolveRecipients(process.id);
    if (recipients.length === 0) return { sent: 0, failed: 0 };

    let sent = 0;
    let failed = 0;
    for (const movement of insertedMovements) {
      for (const recipient of recipients) {
        const alreadySent = await this.notificationLog.wasAlreadySent(
          movement.id,
          recipient.type,
          recipient.clientId,
        );
        if (alreadySent) continue;

        const message = this.messageTemplate.render({ cnjNumber: process.cnjNumber, movement });
        try {
          await this.notifier.sendText(recipient.phone, message);
          await this.notificationLog.recordSent({
            spaceId: process.spaceId,
            processId: process.id,
            movementId: movement.id,
            recipientType: recipient.type,
            recipientClientId: recipient.clientId,
            phone: recipient.phone,
          });
          sent += 1;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await this.notificationLog.recordFailed({
            spaceId: process.spaceId,
            processId: process.id,
            movementId: movement.id,
            recipientType: recipient.type,
            recipientClientId: recipient.clientId,
            phone: recipient.phone,
            error: errorMessage,
          });
          failed += 1;
        }
      }
    }
    return { sent, failed };
  }
}
