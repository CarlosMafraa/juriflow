import type { SupabaseClient } from '@supabase/supabase-js';
import type { DeliveryRecord, NotificationLog } from '../ports/notification-log.port.js';
import type { RecipientType } from '../ports/recipient-resolver.port.js';

interface DeliveryKey {
  movementId: string;
  recipientType: RecipientType;
  /** Cliente (recipient_client_id) ou perfil do responsável (recipient_profile_id). */
  recipientId: string;
}

const RECIPIENT_COLUMN: Record<RecipientType, string> = {
  client: 'recipient_client_id',
  responsible: 'recipient_profile_id',
};

interface DeliveryRow {
  movement_id: string;
  recipient_type: RecipientType;
  recipient_client_id: string | null;
  recipient_profile_id: string | null;
  status: 'sent' | 'failed';
  attempts: number;
}

const PAGE_SIZE = 1000;

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

  async listDeliveries(processId: string): Promise<readonly DeliveryRecord[]> {
    const result: DeliveryRecord[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await this.client
        .from('notification_deliveries')
        .select(
          'movement_id, recipient_type, recipient_client_id, recipient_profile_id, status, attempts',
        )
        .eq('process_id', processId)
        .order('id')
        .range(from, from + PAGE_SIZE - 1)
        .returns<DeliveryRow[]>();
      if (error)
        throw new Error(`Falha ao listar envios do processo ${processId}: ${error.message}`);
      const rows = data ?? [];
      for (const row of rows) {
        const recipientId =
          row.recipient_type === 'client' ? row.recipient_client_id : row.recipient_profile_id;
        // Perfil apagado (on delete set null): não há mais a quem enviar.
        if (!recipientId) continue;
        result.push({
          movementId: row.movement_id,
          recipientType: row.recipient_type,
          recipientId,
          status: row.status,
          attempts: row.attempts,
        });
      }
      if (rows.length < PAGE_SIZE) return result;
    }
  }

  async recordSent(input: {
    spaceId: string;
    processId: string;
    movementId: string;
    recipientType: RecipientType;
    recipientId: string;
    phone: string;
  }): Promise<void> {
    await this.write(input, { status: 'sent', error: null, sentAt: new Date() });
  }

  async recordFailed(input: {
    spaceId: string;
    processId: string;
    movementId: string;
    recipientType: RecipientType;
    recipientId: string;
    phone: string;
    error: string;
  }): Promise<void> {
    await this.write(input, { status: 'failed', error: input.error, sentAt: null });
  }

  private async findExisting(
    key: DeliveryKey,
  ): Promise<{ id: string; status: string; attempts: number } | null> {
    const { data, error } = await this.client
      .from('notification_deliveries')
      .select('id, status, attempts')
      .eq('movement_id', key.movementId)
      .eq('recipient_type', key.recipientType)
      .eq(RECIPIENT_COLUMN[key.recipientType], key.recipientId)
      .maybeSingle<{ id: string; status: string; attempts: number }>();
    if (error) throw new Error(`Falha ao consultar notification_deliveries: ${error.message}`);
    return data;
  }

  private async write(
    input: DeliveryWrite,
    outcome: { status: 'sent' | 'failed'; error: string | null; sentAt: Date | null },
  ): Promise<void> {
    const existing = await this.findExisting(input);
    const payload = {
      attempts: existing ? existing.attempts + 1 : 1,
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
          [RECIPIENT_COLUMN[input.recipientType]]: input.recipientId,
          ...payload,
        });

    if (error) throw new Error(`Falha ao registrar notification_delivery: ${error.message}`);
  }
}
