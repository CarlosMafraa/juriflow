import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationRecipient, RecipientResolver } from '../ports/recipient-resolver.port.js';

/**
 * RN seções 10/28: responsável atual sempre é candidato (se tiver telefone);
 * clientes vinculados só entram se `notification_opt_in = true` e telefone presente.
 * Regras de notificação configuráveis por evento (Fase 10) ficam de fora do MVP.
 */
export class SupabaseRecipientResolver implements RecipientResolver {
  constructor(private readonly client: SupabaseClient) {}

  async resolveRecipients(processId: string): Promise<NotificationRecipient[]> {
    const [responsible, clients] = await Promise.all([
      this.resolveResponsible(processId),
      this.resolveClients(processId),
    ]);
    return [...responsible, ...clients];
  }

  private async resolveResponsible(processId: string): Promise<NotificationRecipient[]> {
    const { data, error } = await this.client
      .from('processes')
      .select('profiles!processes_assigned_user_id_fkey(phone)')
      .eq('id', processId)
      .maybeSingle<{ profiles: { phone: string | null } | null }>();

    if (error)
      throw new Error(`Falha ao resolver responsável do processo ${processId}: ${error.message}`);
    const phone = data?.profiles?.phone;
    return phone ? [{ type: 'responsible', phone, clientId: null }] : [];
  }

  private async resolveClients(processId: string): Promise<NotificationRecipient[]> {
    const { data, error } = await this.client
      .from('process_clients')
      .select('client_id, clients!inner(phone, notification_opt_in, deleted_at)')
      .eq('process_id', processId)
      .is('deleted_at', null)
      .returns<
        {
          client_id: string;
          clients: {
            phone: string | null;
            notification_opt_in: boolean;
            deleted_at: string | null;
          };
        }[]
      >();

    if (error)
      throw new Error(`Falha ao resolver clientes do processo ${processId}: ${error.message}`);
    return (data ?? [])
      .filter(
        (row) => row.clients.notification_opt_in && row.clients.phone && !row.clients.deleted_at,
      )
      .map((row) => ({
        type: 'client' as const,
        phone: row.clients.phone as string,
        clientId: row.client_id,
      }));
  }
}
