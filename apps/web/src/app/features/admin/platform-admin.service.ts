import { Injectable, inject } from '@angular/core';
import type { Profile, Space } from '@juriflow/shared-types';
import { SUPABASE_CLIENT } from '../../core/supabase/supabase-client';

interface SpaceRow {
  id: string;
  name: string;
  slug: string;
  status: Space['status'];
  max_processes: number;
  max_tracked_processes: number;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  is_super_admin: boolean;
  avatar_url: string | null;
  created_at: string;
  updated_at: string | null;
}

function toSpace(r: SpaceRow): Space {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    maxProcesses: r.max_processes,
    maxTrackedProcesses: r.max_tracked_processes,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toProfile(r: ProfileRow): Profile {
  return {
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    phone: r.phone,
    isSuperAdmin: r.is_super_admin,
    avatarUrl: r.avatar_url,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base || 'espaco'}-${suffix}`;
}

/**
 * Administração da plataforma (SUPER_ADMIN, RN7: opera a plataforma, não o
 * conteúdo operacional de um tenant). RLS já concede acesso direto às tabelas
 * `spaces`/`profiles` para SUPER_ADMIN — nenhuma RPC é necessária.
 */
@Injectable({ providedIn: 'root' })
export class PlatformAdminService {
  private readonly supabase = inject(SUPABASE_CLIENT);

  async listSpaces(): Promise<Space[]> {
    const { data, error } = await this.supabase.from('spaces').select('*').order('name');
    if (error) throw error;
    return ((data ?? []) as SpaceRow[]).map(toSpace);
  }

  /**
   * Cria o espaço já com o ADMIN inicial, numa transação só (RPC
   * `create_space_with_admin`). É o único momento em que a plataforma toca em
   * membros — depois disso, quem gere o espaço é o ADMIN dele. O plano nasce
   * com os valores padrão (Free) e é ajustado em `updatePlan`.
   */
  async createSpace(name: string, adminProfileId: string): Promise<void> {
    const { error } = await this.supabase.rpc('create_space_with_admin', {
      p_name: name.trim(),
      p_slug: slugify(name),
      p_admin_profile_id: adminProfileId,
    });
    if (error) throw error;
  }

  async updatePlan(id: string, maxProcesses: number, maxTrackedProcesses: number): Promise<void> {
    const { error } = await this.supabase
      .from('spaces')
      .update({ max_processes: maxProcesses, max_tracked_processes: maxTrackedProcesses })
      .eq('id', id);
    if (error) throw error;
  }

  /** Convite de plataforma (Edge Function `send-invite`): cria a conta e manda o e-mail. */
  async inviteUser(email: string): Promise<'invited' | 'existing_user' | 'failed'> {
    const { data, error } = await this.supabase.functions.invoke<{
      status: 'invited' | 'existing_user';
    }>('send-invite', { body: { email } });
    if (error || !data) return 'failed';
    return data.status;
  }

  async setSpaceStatus(id: string, status: Space['status']): Promise<void> {
    const { error } = await this.supabase.from('spaces').update({ status }).eq('id', id);
    if (error) throw error;
  }

  async listProfiles(): Promise<Profile[]> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('*')
      .order('full_name', { ascending: true, nullsFirst: false });
    if (error) throw error;
    return ((data ?? []) as ProfileRow[]).map(toProfile);
  }

  async setSuperAdmin(id: string, isSuperAdmin: boolean): Promise<void> {
    const { error } = await this.supabase
      .from('profiles')
      .update({ is_super_admin: isSuperAdmin })
      .eq('id', id);
    if (error) throw error;
  }
}
