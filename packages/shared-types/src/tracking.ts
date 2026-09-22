import type { IsoDateTime, Uuid } from './entities.js';

/**
 * MVP Acompanhamento — tipos de `process_movements` e `notification_deliveries`.
 * `sourceKind` é string livre (mesmo union aberto de `@juriflow/collectors-core`);
 * este pacote não depende do collectors-core para não acoplar tipos de dados a
 * contratos de coleta.
 */

export interface ProcessMovement {
  id: Uuid;
  spaceId: Uuid;
  processId: Uuid;
  sourceKind: string;
  sourceMovementId: string | null;
  description: string;
  occurredAt: IsoDateTime | null;
  collectedAt: IsoDateTime;
  raw: Record<string, unknown>;
  contentHash: string;
  createdAt: IsoDateTime;
}

export const NOTIFICATION_RECIPIENT_TYPES = ['responsible', 'client'] as const;
export type NotificationRecipientType = (typeof NOTIFICATION_RECIPIENT_TYPES)[number];

export const NOTIFICATION_DELIVERY_STATUSES = ['sent', 'failed'] as const;
export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number];

export interface NotificationDelivery {
  id: Uuid;
  spaceId: Uuid;
  processId: Uuid;
  movementId: Uuid;
  recipientType: NotificationRecipientType;
  recipientClientId: Uuid | null;
  phone: string;
  status: NotificationDeliveryStatus;
  error: string | null;
  sentAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime | null;
}
