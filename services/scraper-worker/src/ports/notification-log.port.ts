import type { RecipientType } from './recipient-resolver.port.js';

/**
 * Porta de idempotência de envio (`notification_deliveries`). Garante que o
 * mesmo destinatário nunca recebe a mesma movimentação duas vezes, mesmo que
 * o pipeline rode de novo (retry, consulta manual repetida).
 */
export interface NotificationLog {
  /** true se já existe um envio BEM-SUCEDIDO para este (movement, destinatário). */
  wasAlreadySent(
    movementId: string,
    recipientType: RecipientType,
    recipientId: string,
  ): Promise<boolean>;

  /**
   * Movimentações do processo com aviso que FALHOU e ainda pode ser tentado de
   * novo (menos de `maxAttempts` tentativas) — regra N7.
   */
  listRetryableMovementIds(processId: string, maxAttempts: number): Promise<string[]>;

  recordSent(input: {
    spaceId: string;
    processId: string;
    movementId: string;
    recipientType: RecipientType;
    recipientId: string;
    phone: string;
  }): Promise<void>;

  recordFailed(input: {
    spaceId: string;
    processId: string;
    movementId: string;
    recipientType: RecipientType;
    recipientId: string;
    phone: string;
    error: string;
  }): Promise<void>;
}
