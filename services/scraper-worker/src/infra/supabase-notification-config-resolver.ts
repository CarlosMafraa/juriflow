import type { SupabaseClient } from '@supabase/supabase-js';
import {
  resolveEffectiveConfig,
  type EffectiveNotificationConfig,
  type RawNotificationConfig,
} from '../domain/notification-config.js';
import type { NotificationConfigResolver } from '../ports/notification-config.port.js';

interface ConfigRow {
  notify_responsible: boolean | null;
  notify_clients: boolean | null;
  responsible_template_id: string | null;
  client_template_id: string | null;
}

function toRaw(row: ConfigRow | null): RawNotificationConfig | null {
  if (!row) return null;
  return {
    notifyResponsible: row.notify_responsible,
    notifyClients: row.notify_clients,
    responsibleTemplateId: row.responsible_template_id,
    clientTemplateId: row.client_template_id,
  };
}

/** Busca as duas configs (espaço + processo) e delega a fusão pra função pura do domínio. */
export class SupabaseNotificationConfigResolver implements NotificationConfigResolver {
  constructor(private readonly client: SupabaseClient) {}

  async resolve(processId: string, spaceId: string): Promise<EffectiveNotificationConfig> {
    const [spaceResult, processResult] = await Promise.all([
      this.client
        .from('space_notification_configs')
        .select('notify_responsible, notify_clients, responsible_template_id, client_template_id')
        .eq('space_id', spaceId)
        .maybeSingle<ConfigRow>(),
      this.client
        .from('process_notification_configs')
        .select('notify_responsible, notify_clients, responsible_template_id, client_template_id')
        .eq('process_id', processId)
        .maybeSingle<ConfigRow>(),
    ]);

    if (spaceResult.error)
      throw new Error(`Falha ao ler config de notificação do espaço: ${spaceResult.error.message}`);
    if (processResult.error)
      throw new Error(
        `Falha ao ler config de notificação do processo: ${processResult.error.message}`,
      );

    return resolveEffectiveConfig(toRaw(spaceResult.data), toRaw(processResult.data));
  }
}
