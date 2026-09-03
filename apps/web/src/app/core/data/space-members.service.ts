import { Injectable, inject } from '@angular/core';
import type { SpaceRole } from '@juriflow/shared-types';
import { SUPABASE_CLIENT } from '../supabase/supabase-client';

export interface SpaceMemberOption {
  profileId: string;
  fullName: string;
  role: SpaceRole;
}

interface Row {
  profile_id: string;
  role: SpaceRole;
  profiles: { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null;
}

/** Membros ativos de um espaço — para selecionar responsável e transferir processos. */
@Injectable({ providedIn: 'root' })
export class SpaceMembersService {
  private readonly supabase = inject(SUPABASE_CLIENT);

  async listActive(spaceId: string): Promise<SpaceMemberOption[]> {
    const { data, error } = await this.supabase
      .from('space_members')
      .select('profile_id, role, profiles(full_name, email)')
      .eq('space_id', spaceId)
      .eq('status', 'active');
    if (error) throw error;

    return ((data ?? []) as Row[]).map((r) => {
      const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
      return {
        profileId: r.profile_id,
        fullName: p?.full_name || p?.email || r.profile_id,
        role: r.role,
      };
    });
  }
}
