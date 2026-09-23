import { Injectable, inject } from '@angular/core';
import type { WhatsappSession, WhatsappSessionStatus } from '@juriflow/shared-types';
import { SUPABASE_CLIENT } from '../../core/supabase/supabase-client';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';

interface WhatsappSessionRow {
  space_id: string;
  session_name: string;
  status: WhatsappSessionStatus;
  pending_action: 'connect' | 'disconnect' | null;
  qr_code: string | null;
  last_error: string | null;
  requested_by: string | null;
  requested_at: string | null;
  connected_at: string | null;
  last_checked_at: string | null;
  updated_at: string | null;
}

function toSession(r: WhatsappSessionRow): WhatsappSession {
  return {
    spaceId: r.space_id,
    sessionName: r.session_name,
    status: r.status,
    pendingAction: r.pending_action,
    qrCode: r.qr_code,
    lastError: r.last_error,
    requestedBy: r.requested_by,
    requestedAt: r.requested_at,
    connectedAt: r.connected_at,
    lastCheckedAt: r.last_checked_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Sessão WhatsApp (WAHA) do espaço ativo — RN seção 22 / F12. O ADMIN só sinaliza
 * intenção (RPCs); quem fala com o WAHA de fato é o polling job do scraper-worker.
 */
@Injectable({ providedIn: 'root' })
export class WhatsappService {
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly activeSpace = inject(ActiveSpaceService);

  private spaceId(): string {
    const id = this.activeSpace.activeSpaceId();
    if (!id) throw new Error('Nenhum espaço ativo.');
    return id;
  }

  async getSession(): Promise<WhatsappSession | null> {
    const { data, error } = await this.supabase
      .from('whatsapp_sessions')
      .select('*')
      .eq('space_id', this.spaceId())
      .maybeSingle();
    if (error) throw error;
    return data ? toSession(data as WhatsappSessionRow) : null;
  }

  async requestConnect(): Promise<WhatsappSession> {
    const { data, error } = await this.supabase.rpc('request_whatsapp_connect', {
      p_space_id: this.spaceId(),
    });
    if (error) throw error;
    return toSession(data as WhatsappSessionRow);
  }

  async requestDisconnect(): Promise<WhatsappSession> {
    const { data, error } = await this.supabase.rpc('request_whatsapp_disconnect', {
      p_space_id: this.spaceId(),
    });
    if (error) throw error;
    return toSession(data as WhatsappSessionRow);
  }
}
