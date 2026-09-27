import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CatchupRequest,
  NotificationCatchupQueue,
} from '../ports/notification-catchup-queue.port.js';

interface Row {
  process_id: string;
  requested_at: string;
  processes: { tracking_enabled: boolean } | null;
}

export class SupabaseNotificationCatchupQueue implements NotificationCatchupQueue {
  constructor(private readonly client: SupabaseClient) {}

  async list(limit: number): Promise<readonly CatchupRequest[]> {
    const { data, error } = await this.client
      .from('notification_catchup_requests')
      .select('process_id, requested_at, processes(tracking_enabled)')
      .order('requested_at')
      .limit(limit)
      .returns<Row[]>();
    if (error) throw new Error(`Falha ao listar avisos pendentes: ${error.message}`);
    return (data ?? []).map((row) => ({
      processId: row.process_id,
      requestedAt: row.requested_at,
      trackingEnabled: row.processes?.tracking_enabled ?? false,
    }));
  }

  async clear(request: CatchupRequest): Promise<void> {
    const { error } = await this.client
      .from('notification_catchup_requests')
      .delete()
      .eq('process_id', request.processId)
      .eq('requested_at', request.requestedAt);
    if (error)
      throw new Error(
        `Falha ao limpar aviso pendente do processo ${request.processId}: ${error.message}`,
      );
  }
}
