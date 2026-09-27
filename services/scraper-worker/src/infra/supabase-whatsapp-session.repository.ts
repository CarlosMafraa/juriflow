import type { SupabaseClient } from '@supabase/supabase-js';
import type { MessagingChannel } from '../ports/messaging-channel.port.js';
import type {
  WhatsappSessionRepository,
  WhatsappSessionRow,
} from '../ports/whatsapp-session-repository.port.js';

interface Row {
  space_id: string;
  session_name: string;
  status: WhatsappSessionRow['status'];
  pending_action: WhatsappSessionRow['pendingAction'];
}

export class SupabaseWhatsappSessionRepository
  implements WhatsappSessionRepository, MessagingChannel
{
  constructor(private readonly client: SupabaseClient) {}

  async listActionable(): Promise<readonly WhatsappSessionRow[]> {
    const { data, error } = await this.client
      .from('whatsapp_sessions')
      .select('space_id, session_name, status, pending_action')
      .or('pending_action.not.is.null,status.in.(connecting,qr_ready)')
      .returns<Row[]>();
    if (error) throw new Error(`Falha ao listar whatsapp_sessions: ${error.message}`);
    return (data ?? []).map(toSessionRow);
  }

  async listConnected(): Promise<readonly WhatsappSessionRow[]> {
    const { data, error } = await this.client
      .from('whatsapp_sessions')
      .select('space_id, session_name, status, pending_action')
      .eq('status', 'connected')
      .is('pending_action', null)
      .returns<Row[]>();
    if (error) throw new Error(`Falha ao listar sessões conectadas: ${error.message}`);
    return (data ?? []).map(toSessionRow);
  }

  async isConnected(spaceId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('whatsapp_sessions')
      .select('status')
      .eq('space_id', spaceId)
      .maybeSingle<{ status: string }>();
    if (error) throw new Error(`Falha ao ler a sessão WhatsApp do espaço: ${error.message}`);
    return data?.status === 'connected';
  }

  async touchConnected(spaceId: string): Promise<void> {
    await this.update(spaceId, { last_checked_at: nowIso() });
  }

  async markConnecting(spaceId: string): Promise<void> {
    await this.update(spaceId, { status: 'connecting', pending_action: null });
  }

  async markQrReady(spaceId: string, qrCode: string): Promise<void> {
    await this.update(spaceId, { status: 'qr_ready', qr_code: qrCode, last_checked_at: nowIso() });
  }

  async markConnected(spaceId: string): Promise<void> {
    await this.update(spaceId, {
      status: 'connected',
      pending_action: null,
      qr_code: null,
      last_error: null,
      connected_at: nowIso(),
      last_checked_at: nowIso(),
    });
  }

  async markDisconnected(spaceId: string, reason?: string): Promise<void> {
    await this.update(spaceId, {
      status: 'disconnected',
      pending_action: null,
      qr_code: null,
      last_error: reason ?? null,
      connected_at: null,
      last_checked_at: nowIso(),
    });
  }

  async markFailed(spaceId: string, error: string): Promise<void> {
    await this.update(spaceId, {
      status: 'failed',
      pending_action: null,
      last_error: error,
      last_checked_at: nowIso(),
    });
  }

  private async update(spaceId: string, payload: Record<string, unknown>): Promise<void> {
    const { error } = await this.client
      .from('whatsapp_sessions')
      .update(payload)
      .eq('space_id', spaceId);
    if (error)
      throw new Error(`Falha ao atualizar whatsapp_sessions (${spaceId}): ${error.message}`);
  }
}

function toSessionRow(row: Row): WhatsappSessionRow {
  return {
    spaceId: row.space_id,
    sessionName: row.session_name,
    status: row.status,
    pendingAction: row.pending_action,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}
