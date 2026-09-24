import { Injectable, inject } from '@angular/core';
import type { Space } from '@juriflow/shared-types';
import { SUPABASE_CLIENT } from '../../core/supabase/supabase-client';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';

interface SpaceRow {
  id: string;
  name: string;
  slug: string;
  status: Space['status'];
  color: string;
  secondary_color: string;
  created_by: string | null;
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
    secondaryColor: r.secondary_color,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Dados do espaço ativo (nome, cor primária/secundária — define o tema) — edição é do ADMIN (RLS: spaces_update). */
@Injectable({ providedIn: 'root' })
export class SpaceSettingsService {
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly activeSpace = inject(ActiveSpaceService);

  private spaceId(): string {
    const id = this.activeSpace.activeSpaceId();
    if (!id) throw new Error('Nenhum espaço ativo.');
    return id;
  }

  async get(): Promise<Space> {
    const { data, error } = await this.supabase
      .from('spaces')
      .select('*')
      .eq('id', this.spaceId())
      .single();
    if (error) throw error;
    return toSpace(data as SpaceRow);
  }

  async update(input: { name: string; color: string; secondaryColor: string }): Promise<void> {
    const { error } = await this.supabase
      .from('spaces')
      .update({
        name: input.name.trim(),
        color: input.color,
        secondary_color: input.secondaryColor,
      })
      .eq('id', this.spaceId());
    if (error) throw error;
  }
}
