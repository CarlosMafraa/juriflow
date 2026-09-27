import type { RecipientType } from './recipient-resolver.port.js';

/** Situação do aviso de uma movimentação para um destinatário. */
export interface DeliveryRecord {
  readonly movementId: string;
  readonly recipientType: RecipientType;
  /** Cliente ou perfil do responsável. */
  readonly recipientId: string;
  readonly status: 'sent' | 'failed';
  readonly attempts: number;
}

/**
 * Porta de idempotência de envio (`notification_deliveries`). Garante que o
 * mesmo destinatário nunca recebe a mesma movimentação duas vezes, mesmo que
 * o pipeline rode de novo (retry, consulta manual repetida, avisos pendentes).
 */
export interface NotificationLog {
  /** Todos os registros de envio do processo — o pipeline decide o que falta. */
  listDeliveries(processId: string): Promise<readonly DeliveryRecord[]>;

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
