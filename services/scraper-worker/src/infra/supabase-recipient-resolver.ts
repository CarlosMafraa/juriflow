import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationRecipient, RecipientResolver } from '../ports/recipient-resolver.port.js';

/**
 * RN seções 10/28: todos os responsáveis atuais (períodos abertos em
 * process_responsible_history) com telefone e vínculo ativo no espaço; clientes
 * vinculados só entram se `notification_opt_in = true` e telefone presente.
 * Se cada público recebe ou não é decidido depois, pela configuração geral do
 * espaço ou pela específica do processo (notification-config).
 */
export class SupabaseRecipientResolver implements RecipientResolver {
  constructor(private readonly client: SupabaseClient) {}

  async resolveRecipients(processId: string): Promise<NotificationRecipient[]> {
    const [responsibles, clients] = await Promise.all([
      this.resolveResponsibles(processId),
      this.resolveClients(processId),
    ]);
    return [...responsibles, ...clients];
  }

  private async resolveResponsibles(processId: string): Promise<NotificationRecipient[]> {
    const { data, error } = await this.client
      .from('process_responsible_history')
      .select(
        'responsible_id, space_id, profiles!process_responsible_history_responsible_id_fkey(phone)',
      )
      .eq('process_id', processId)
      .is('ended_at', null)
      .returns<
        { responsible_id: string; space_id: string; profiles: { phone: string | null } | null }[]
      >();
    if (error)
      throw new Error(`Falha ao resolver responsáveis do processo ${processId}: ${error.message}`);
    const rows = (data ?? []).filter((r) => r.profiles?.phone);
    if (rows.length === 0) return [];

    // Responsável desativado no espaço continua no histórico, mas não recebe.
    const { data: members, error: membersError } = await this.client
      .from('space_members')
      .select('profile_id')
      .eq('space_id', rows[0]!.space_id)
      .eq('status', 'active')
      .in(
        'profile_id',
        rows.map((r) => r.responsible_id),
      )
      .returns<{ profile_id: string }[]>();
    if (membersError)
      throw new Error(
        `Falha ao conferir vínculos do processo ${processId}: ${membersError.message}`,
      );
    const active = new Set((members ?? []).map((m) => m.profile_id));

    return rows
      .filter((r) => active.has(r.responsible_id))
      .map((r) => ({
        type: 'responsible' as const,
        phone: r.profiles!.phone as string,
        recipientId: r.responsible_id,
      }));
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
        recipientId: row.client_id,
      }));
  }
}
