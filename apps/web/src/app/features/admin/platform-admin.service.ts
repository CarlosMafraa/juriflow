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
  planId: string;
  planName: string;
  /** Exceções ao plano (null = segue o plano). */
  overrideMaxProcesses: number | null;
  overrideMaxTrackedProcesses: number | null;
  overrideTrackingHoldDays: number | null;
  /** O que vale: exceção, senão o plano. */
  maxProcesses: number;
  maxTrackedProcesses: number;
  trackingHoldDays: number;
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

/** Plano do catálogo da plataforma. */
export interface Plan {
  id: string;
  name: string;
  maxProcesses: number;
  maxTrackedProcesses: number;
  /** Anti-rodízio: dias que a vaga fica presa depois de desligar a sincronização. */
  trackingHoldDays: number;
  isDefault: boolean;
  spacesCount: number;
}

export interface PlanInput {
  name: string;
  maxProcesses: number;
  maxTrackedProcesses: number;
  trackingHoldDays: number;
}

/** Plano do escritório + exceções (null = segue o plano). */
export interface SpacePlanInput {
  planId: string;
  maxProcesses: number | null;
  maxTrackedProcesses: number | null;
  trackingHoldDays: number | null;
}

type Row = Record<string, unknown>;

function toPlatformSpace(r: Row): PlatformSpace {
  return {
    id: r['id'] as string,
    name: r['name'] as string,
    status: r['status'] as SpaceStatus,
    planId: r['plan_id'] as string,
    planName: r['plan_name'] as string,
    overrideMaxProcesses: (r['override_max_processes'] as number) ?? null,
    overrideMaxTrackedProcesses: (r['override_max_tracked_processes'] as number) ?? null,
    overrideTrackingHoldDays: (r['override_tracking_hold_days'] as number) ?? null,
    maxProcesses: r['max_processes'] as number,
    maxTrackedProcesses: r['max_tracked_processes'] as number,
    trackingHoldDays: r['tracking_hold_days'] as number,
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

  // Status e plano só pelas funções da plataforma (auditadas): a plataforma
  // não tem acesso direto à tabela de escritórios.
  async setSpacePlan(id: string, input: SpacePlanInput): Promise<void> {
    const { error } = await this.supabase.rpc('platform_set_space_plan', {
      p_space_id: id,
      p_plan_id: input.planId,
      p_max_processes: input.maxProcesses,
      p_max_tracked_processes: input.maxTrackedProcesses,
      p_tracking_hold_days: input.trackingHoldDays,
    });
    if (error) throw error;
  }

  async listPlans(): Promise<Plan[]> {
    const { data, error } = await this.supabase.rpc('platform_plans');
    if (error) throw error;
    return ((data ?? []) as Row[]).map((r) => ({
      id: r['id'] as string,
      name: r['name'] as string,
      maxProcesses: r['max_processes'] as number,
      maxTrackedProcesses: r['max_tracked_processes'] as number,
      trackingHoldDays: r['tracking_hold_days'] as number,
      isDefault: r['is_default'] as boolean,
      spacesCount: r['spaces_count'] as number,
    }));
  }

  /** Cria (id null) ou altera um plano; vale na hora para os escritórios dele. */
  async savePlan(id: string | null, input: PlanInput): Promise<void> {
    const { error } = await this.supabase.rpc('platform_save_plan', {
      p_plan_id: id,
      p_name: input.name.trim(),
      p_max_processes: input.maxProcesses,
      p_max_tracked_processes: input.maxTrackedProcesses,
      p_tracking_hold_days: input.trackingHoldDays,
    });
    if (error) throw error;
  }

  async deletePlan(id: string): Promise<void> {
    const { error } = await this.supabase.rpc('platform_delete_plan', { p_plan_id: id });
    if (error) throw error;
  }

  /** Exclui de vez um escritório que ainda aguarda configuração. */
  async deletePendingSpace(id: string): Promise<void> {
    const { error } = await this.supabase.rpc('platform_delete_pending_space', { p_space_id: id });
    if (error) throw error;
  }

  async setSpaceStatus(id: string, status: SpaceStatus): Promise<void> {
    const { error } = await this.supabase.rpc('platform_set_space_status', {
      p_space_id: id,
      p_status: status,
    });
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
