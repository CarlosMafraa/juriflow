import { Injectable, inject } from '@angular/core';
import type { Profile, Space } from '@juriflow/shared-types';
import { SUPABASE_CLIENT } from '../../core/supabase/supabase-client';
import { AuthService } from '../../core/auth/auth.service';

interface SpaceRow {
  id: string;
  name: string;
  slug: string;
  status: Space['status'];
  color: string;
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
    color: r.color,
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
  private readonly auth = inject(AuthService);

  async listSpaces(): Promise<Space[]> {
    const { data, error } = await this.supabase.from('spaces').select('*').order('name');
    if (error) throw error;
    return ((data ?? []) as SpaceRow[]).map(toSpace);
  }

  /**
   * Cria o espaço e já vincula `adminProfileId` como ADMIN ativo — sem isso o
   * espaço fica sem ninguém para geri-lo (SUPER_ADMIN não recebe
   * `space.manage`/`member.*`, RN7). Ver policy `space_members_insert`
   * (migração 0004): "provisionamento" é o único caso em que SUPER_ADMIN
   * insere em `space_members` direto, sem convite por token.
   */
  async createSpace(name: string, adminProfileId: string): Promise<Space> {
    const { data, error } = await this.supabase
      .from('spaces')
      .insert({ name: name.trim(), slug: slugify(name), created_by: this.auth.userId() })
      .select('*')
      .single();
    if (error) throw error;
    const space = toSpace(data as SpaceRow);

    const { error: memberError } = await this.supabase.from('space_members').insert({
      space_id: space.id,
      profile_id: adminProfileId,
      role: 'ADMIN',
      status: 'active',
    });
    if (memberError) throw memberError;

    return space;
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
