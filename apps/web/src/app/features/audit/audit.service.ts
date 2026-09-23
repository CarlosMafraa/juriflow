import { Injectable, inject } from '@angular/core';
import type { AuditLog } from '@juriflow/shared-types';
import { SUPABASE_CLIENT } from '../../core/supabase/supabase-client';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';
import type { Page } from '../clients/client.service';

interface AuditLogRow {
  id: string;
  space_id: string | null;
  actor_id: string | null;
  actor_type: AuditLog['actorType'];
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  result: AuditLog['result'];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  created_at: string;
  profiles: { full_name: string | null; email: string | null } | null;
}

export interface AuditLogEntry extends AuditLog {
  actorName: string | null;
}

export interface AuditFilters {
  action?: string;
  entityType?: string;
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 20;

function toEntry(r: AuditLogRow): AuditLogEntry {
  return {
    id: r.id,
    spaceId: r.space_id,
    actorId: r.actor_id,
    actorType: r.actor_type,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    result: r.result,
    before: r.before,
    after: r.after,
    context: r.context,
    createdAt: r.created_at,
    actorName: r.profiles?.full_name || r.profiles?.email || null,
  };
}

/** Trilha de auditoria do espaço ativo — leitura só (RN: append-only, sem escrita client-side). */
@Injectable({ providedIn: 'root' })
export class AuditService {
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly activeSpace = inject(ActiveSpaceService);

  private spaceId(): string {
    const id = this.activeSpace.activeSpaceId();
    if (!id) throw new Error('Nenhum espaço ativo.');
    return id;
  }

  async list(filters: AuditFilters = {}): Promise<Page<AuditLogEntry>> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
    const from = (page - 1) * pageSize;

    let q = this.supabase
      .from('audit_logs')
      .select('*, profiles(full_name, email)', { count: 'exact' })
      .eq('space_id', this.spaceId())
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (filters.action) q = q.eq('action', filters.action);
    if (filters.entityType?.trim()) q = q.eq('entity_type', filters.entityType.trim());

    const { data, error, count } = await q;
    if (error) throw error;
    return {
      rows: ((data ?? []) as unknown as AuditLogRow[]).map(toEntry),
      total: count ?? 0,
      page,
      pageSize,
    };
  }
}
