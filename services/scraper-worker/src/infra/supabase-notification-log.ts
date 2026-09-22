import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationLog } from '../ports/notification-log.port.js';
import type { RecipientType } from '../ports/recipient-resolver.port.js';

interface DeliveryKey {
  movementId: string;
  recipientType: RecipientType;
  recipientClientId: string | null;
}

interface DeliveryWrite extends DeliveryKey {
  spaceId: string;
  processId: string;
  phone: string;
}

/**
 * `notification_deliveries` tem índices únicos PARCIAIS (por recipient_type) —
 * o PostgREST/Supabase upsert não infere conflito em índice parcial sem
 * predicado, então fazemos select-então-update/insert em vez de ON CONFLICT.
 * Sem concorrência real aqui: o worker processa um processo por vez (ver job).
 */
export class SupabaseNotificationLog implements NotificationLog {
  constructor(private readonly client: SupabaseClient) {}

  async wasAlreadySent(
    movementId: string,
    recipientType: RecipientType,
    recipientClientId: string | null,
  ): Promise<boolean> {
    const existing = await this.findExisting({ movementId, recipientType, recipientClientId });
    return existing?.status === 'sent';
  }

  async recordSent(input: {
    spaceId: string;
    processId: string;
    movementId: string;
    recipientType: RecipientType;
    recipientClientId: string | null;
    phone: string;
  }): Promise<void> {
    await this.write(input, { status: 'sent', error: null, sentAt: new Date() });
  }

  async recordFailed(input: {
    spaceId: string;
    processId: string;
    movementId: string;
    recipientType: RecipientType;
    recipientClientId: string | null;
    phone: string;
    error: string;
  }): Promise<void> {
    await this.write(input, { status: 'failed', error: input.error, sentAt: null });
  }

  private async findExisting(key: DeliveryKey): Promise<{ id: string; status: string } | null> {
    let query = this.client
      .from('notification_deliveries')
      .select('id, status')
      .eq('movement_id', key.movementId)
      .eq('recipient_type', key.recipientType);

    query = key.recipientClientId
      ? query.eq('recipient_client_id', key.recipientClientId)
      : query.is('recipient_client_id', null);

    const { data, error } = await query.maybeSingle<{ id: string; status: string }>();
    if (error) throw new Error(`Falha ao consultar notification_deliveries: ${error.message}`);
    return data;
  }

  private async write(
    input: DeliveryWrite,
    outcome: { status: 'sent' | 'failed'; error: string | null; sentAt: Date | null },
  ): Promise<void> {
    const existing = await this.findExisting(input);
    const payload = {
      status: outcome.status,
      error: outcome.error,
      sent_at: outcome.sentAt?.toISOString() ?? null,
      phone: input.phone,
    };

    const { error } = existing
      ? await this.client.from('notification_deliveries').update(payload).eq('id', existing.id)
      : await this.client.from('notification_deliveries').insert({
          space_id: input.spaceId,
          process_id: input.processId,
          movement_id: input.movementId,
          recipient_type: input.recipientType,
          recipient_client_id: input.recipientClientId,
          ...payload,
        });

    if (error) throw new Error(`Falha ao registrar notification_delivery: ${error.message}`);
  }
}
