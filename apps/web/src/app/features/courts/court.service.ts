import { Injectable, inject } from '@angular/core';
import type { Court, CourtType } from '@juriflow/shared-types';
import { SUPABASE_CLIENT } from '../../core/supabase/supabase-client';

interface CourtRow {
  id: string;
  name: string;
  type: CourtType;
  jurisdiction: string;
  datajud_code: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface CourtInput {
  name: string;
  type: CourtType;
  jurisdiction: string;
  datajudCode?: string | null;
}

function toCourt(r: CourtRow): Court {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    jurisdiction: r.jurisdiction,
    datajudCode: r.datajud_code,
    active: r.active,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

@Injectable({ providedIn: 'root' })
export class CourtService {
  private readonly supabase = inject(SUPABASE_CLIENT);

  async list(opts: { includeInactive?: boolean; search?: string } = {}): Promise<Court[]> {
    let q = this.supabase.from('courts').select('*').order('name');
    if (!opts.includeInactive) q = q.eq('active', true);
    if (opts.search?.trim()) q = q.ilike('name', `%${opts.search.trim()}%`);
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as CourtRow[]).map(toCourt);
  }

  async create(input: CourtInput): Promise<Court> {
    const { data, error } = await this.supabase
      .from('courts')
      .insert({
        name: input.name.trim(),
        type: input.type,
        jurisdiction: input.jurisdiction.trim(),
        datajud_code: input.datajudCode?.trim() || null,
      })
      .select('*')
      .single();
    if (error) throw error;
    return toCourt(data as CourtRow);
  }

  async update(id: string, patch: Partial<CourtInput>): Promise<void> {
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row['name'] = patch.name.trim();
    if (patch.type !== undefined) row['type'] = patch.type;
    if (patch.jurisdiction !== undefined) row['jurisdiction'] = patch.jurisdiction.trim();
    if (patch.datajudCode !== undefined) row['datajud_code'] = patch.datajudCode?.trim() || null;
    const { error } = await this.supabase.from('courts').update(row).eq('id', id);
    if (error) throw error;
  }

  async setActive(id: string, active: boolean): Promise<void> {
    const { error } = await this.supabase.from('courts').update({ active }).eq('id', id);
    if (error) throw error;
  }
}
