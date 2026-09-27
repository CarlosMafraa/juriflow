import { Injectable, inject } from '@angular/core';
import type { SpaceInvite, SpaceRole } from '@juriflow/shared-types';
import { SUPABASE_CLIENT } from '../../core/supabase/supabase-client';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';

/** Resultado do envio do link do convite. */
export type InviteDelivery = 'sent' | 'email_failed';

/** Situação do link: enviado, aberto, expirado (24 h), substituído, aceito... */
export type InviteState = 'sent' | 'opened' | 'expired' | 'superseded' | 'cancelled' | 'accepted';

export interface InviteOpening {
  state: InviteState;
  role: SpaceRole;
  spaceId: string;
  spaceName: string;
  setupPending: boolean;
}

export interface TeamMember {
  id: string;
  profileId: string;
  role: SpaceRole;
  active: boolean;
  createdAt: string;
  name: string;
  email: string | null;
}

interface MemberRow {
  id: string;
  profile_id: string;
  role: SpaceRole;
  status: 'active' | 'invited' | 'disabled';
  created_at: string;
  profiles: { full_name: string | null; email: string | null } | null;
}

interface InviteRow {
  id: string;
  space_id: string;
  email: string;
  role: SpaceRole;
  status: 'pending' | 'accepted' | 'cancelled' | 'expired';
  expires_at: string;
  created_at: string;
  opened_at: string | null;
}

interface MyPendingInviteRow {
  id: string;
  space_id: string;
  space_name: string;
  role: SpaceRole;
  token: string;
  expires_at: string;
}

function toMember(r: MemberRow): TeamMember {
  return {
    id: r.id,
    profileId: r.profile_id,
    role: r.role,
    active: r.status === 'active',
    createdAt: r.created_at,
    name: r.profiles?.full_name || r.profiles?.email || 'Usuário',
    email: r.profiles?.email ?? null,
  };
}

function toInvite(r: InviteRow): SpaceInvite {
  return {
    id: r.id,
    spaceId: r.space_id,
    email: r.email,
    role: r.role,
    status: r.status,
    expiresAt: r.expires_at,
    sentAt: r.created_at,
    openedAt: r.opened_at,
  };
}

/**
 * Gestão de equipe do espaço: membros, papéis, ativação e convites por e-mail.
 * Convite/aceite são RPCs (`app.create_space_invite` etc., migration 0020)
 * porque o convidado pode ainda não ter `profile` — não dá para modelar isso
 * com um INSERT direto sob RLS comum.
 */
@Injectable({ providedIn: 'root' })
export class TeamService {
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly activeSpace = inject(ActiveSpaceService);

  private spaceId(): string {
    const id = this.activeSpace.activeSpaceId();
    if (!id) throw new Error('Nenhum espaço ativo.');
    return id;
  }

  async listMembers(): Promise<TeamMember[]> {
    // `profiles!space_members_profile_id_fkey` desambigua: space_members tem
    // 2 FKs para profiles (profile_id e invited_by) — embed simples é ambíguo.
    const { data, error } = await this.supabase
      .from('space_members')
      .select(
        'id, profile_id, role, status, created_at, profiles!space_members_profile_id_fkey(full_name, email)',
      )
      .eq('space_id', this.spaceId())
      .order('created_at', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as unknown as MemberRow[]).map(toMember);
  }

  async listPendingInvites(): Promise<SpaceInvite[]> {
    const { data, error } = await this.supabase
      .from('space_invites')
      .select('id, space_id, email, role, status, expires_at, created_at, opened_at')
      .eq('space_id', this.spaceId())
      .eq('status', 'pending')
      .is('superseded_at', null)
      .order('expires_at', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as InviteRow[]).map(toInvite);
  }

  async listMyPendingInvites(): Promise<SpaceInvite[]> {
    const { data, error } = await this.supabase.rpc('my_pending_invites');
    if (error) throw error;
    return ((data ?? []) as MyPendingInviteRow[]).map((r) => ({
      id: r.id,
      spaceId: r.space_id,
      spaceName: r.space_name,
      email: '',
      role: r.role,
      status: 'pending' as const,
      token: r.token,
      expiresAt: r.expires_at,
    }));
  }

  /**
   * Cria o convite (RPC) e pede à Edge Function `send-invite` o e-mail com o
   * link (vale 24 h). Convidar de novo o mesmo e-mail substitui o convite
   * anterior — só o link novo funciona.
   */
  async invite(email: string, role: SpaceRole): Promise<InviteDelivery> {
    const { data: inviteId, error } = await this.supabase.rpc('create_space_invite', {
      p_space_id: this.spaceId(),
      p_email: email.trim().toLowerCase(),
      p_role: role,
    });
    if (error) throw error;
    return this.sendInviteEmail({ inviteId: inviteId as string });
  }

  /** Reenvia: o convite atual fica substituído e sai um link novo. */
  async resendInvite(inviteId: string): Promise<InviteDelivery> {
    const { data, error } = await this.supabase.rpc('reissue_space_invite', {
      p_invite_id: inviteId,
    });
    if (error) throw error;
    return this.sendInviteEmail({ inviteId: data as string });
  }

  /** Quem recebeu o link: marca como aberto e diz em que situação está. */
  async openInvite(inviteId: string): Promise<InviteOpening> {
    const { data, error } = await this.supabase
      .rpc('open_space_invite', { p_invite_id: inviteId })
      .single();
    if (error) throw error;
    const r = data as Record<string, unknown>;
    return {
      state: r['state'] as InviteState,
      role: r['role'] as SpaceRole,
      spaceId: r['space_id'] as string,
      spaceName: r['space_name'] as string,
      setupPending: r['setup_pending'] as boolean,
    };
  }

  async acceptInviteById(inviteId: string): Promise<void> {
    const { error } = await this.supabase.rpc('accept_space_invite_by_id', {
      p_invite_id: inviteId,
    });
    if (error) throw error;
  }

  async completeSpaceSetup(spaceId: string, name: string): Promise<void> {
    const { error } = await this.supabase.rpc('complete_space_setup', {
      p_space_id: spaceId,
      p_name: name,
    });
    if (error) throw error;
  }

  async sendInviteEmail(body: { inviteId: string }): Promise<InviteDelivery> {
    const { data, error } = await this.supabase.functions.invoke<{ status: InviteDelivery }>(
      'send-invite',
      { body },
    );
    if (error || !data) return 'email_failed';
    return data.status;
  }

  async cancelInvite(inviteId: string): Promise<void> {
    const { error } = await this.supabase.rpc('cancel_space_invite', { p_invite_id: inviteId });
    if (error) throw error;
  }

  async acceptInvite(token: string): Promise<void> {
    const { error } = await this.supabase.rpc('accept_space_invite', { p_token: token });
    if (error) throw error;
  }

  async updateRole(memberId: string, role: SpaceRole): Promise<void> {
    const { error } = await this.supabase.from('space_members').update({ role }).eq('id', memberId);
    if (error) throw error;
  }

  async setActive(memberId: string, active: boolean): Promise<void> {
    const { error } = await this.supabase
      .from('space_members')
      .update({ status: active ? 'active' : 'disabled' })
      .eq('id', memberId);
    if (error) throw error;
  }
}
