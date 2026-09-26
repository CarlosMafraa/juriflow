import { Injectable, inject } from '@angular/core';
import type { Space } from '@juriflow/shared-types';
import { SUPABASE_CLIENT } from '../../core/supabase/supabase-client';
import type { InviteState } from '../team/team.service';

type SpaceStatus = Space['status'];

/** Um escritório como a plataforma o enxerga: só por fora. */
export interface PlatformSpace {
  id: string;
  name: string;
  status: SpaceStatus;
  maxProcesses: number;
  maxTrackedProcesses: number;
  createdAt: string;
  /** null = o ADMIN ainda não configurou o escritório. */
  setupCompletedAt: string | null;
  adminEmail: string | null;
  inviteId: string | null;
  inviteState: InviteState | null;
  inviteSentAt: string | null;
  inviteExpiresAt: string | null;
  inviteOpenedAt: string | null;
}

type Row = Record<string, unknown>;

function toPlatformSpace(r: Row): PlatformSpace {
  return {
    id: r['id'] as string,
    name: r['name'] as string,
    status: r['status'] as SpaceStatus,
    maxProcesses: r['max_processes'] as number,
    maxTrackedProcesses: r['max_tracked_processes'] as number,
    createdAt: r['created_at'] as string,
    setupCompletedAt: (r['setup_completed_at'] as string) ?? null,
    adminEmail: (r['admin_email'] as string) ?? null,
    inviteId: (r['invite_id'] as string) ?? null,
    inviteState: (r['invite_state'] as InviteState) ?? null,
    inviteSentAt: (r['invite_sent_at'] as string) ?? null,
    inviteExpiresAt: (r['invite_expires_at'] as string) ?? null,
    inviteOpenedAt: (r['invite_opened_at'] as string) ?? null,
  };
}

/**
 * Administração da plataforma (SUPER_ADMIN). A plataforma cria escritórios
 * convidando o ADMIN de cada um, suspende/reativa e define o plano — e só vê
 * o espaço por fora (nome, status, plano, ADMIN convidado e o convite).
 */
@Injectable({ providedIn: 'root' })
export class PlatformAdminService {
  private readonly supabase = inject(SUPABASE_CLIENT);

  async listSpaces(): Promise<PlatformSpace[]> {
    const { data, error } = await this.supabase.rpc('platform_spaces');
    if (error) throw error;
    return ((data ?? []) as Row[]).map(toPlatformSpace);
  }

  /**
   * Novo escritório: cria o espaço "aguardando configuração" e manda ao ADMIN o
   * link (24 h). O ADMIN completa os dados dele e do escritório ao abrir.
   * Devolve false se o espaço foi criado mas o e-mail não saiu (dá para reenviar).
   */
  async createOffice(adminEmail: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .rpc('create_space_for_admin', { p_email: adminEmail.trim() })
      .single();
    if (error) throw error;
    return this.send((data as Row)['invite_id'] as string);
  }

  /** Reenvia o convite do ADMIN: o link anterior deixa de funcionar. */
  async resendOfficeInvite(inviteId: string): Promise<boolean> {
    const { data, error } = await this.supabase.rpc('reissue_space_invite', {
      p_invite_id: inviteId,
    });
    if (error) throw error;
    return this.send(data as string);
  }

  async updatePlan(id: string, maxProcesses: number, maxTrackedProcesses: number): Promise<void> {
    const { error } = await this.supabase
      .from('spaces')
      .update({ max_processes: maxProcesses, max_tracked_processes: maxTrackedProcesses })
      .eq('id', id);
    if (error) throw error;
  }

  async setSpaceStatus(id: string, status: SpaceStatus): Promise<void> {
    const { error } = await this.supabase.from('spaces').update({ status }).eq('id', id);
    if (error) throw error;
  }

  private async send(inviteId: string): Promise<boolean> {
    const { data, error } = await this.supabase.functions.invoke<{ status: string }>(
      'send-invite',
      { body: { inviteId } },
    );
    return !error && data?.status === 'sent';
  }
}
