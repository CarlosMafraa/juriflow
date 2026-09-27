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
  /** Número do processo / nome do cliente afetado, quando ainda visível. */
  entityName: string | null;
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
    entityName: null,
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
    const rows = ((data ?? []) as unknown as AuditLogRow[]).map(toEntry);
    await this.attachEntityNames(rows);
    return { rows, total: count ?? 0, page, pageSize };
  }

  /**
   * Muitas ações (arquivar, incluir responsável) não carregam o número do
   * processo no próprio registro. Busca o identificador atual de processos e
   * clientes da página — 2 consultas, não uma por linha.
   */
  private async attachEntityNames(rows: AuditLogEntry[]): Promise<void> {
    const idsOf = (type: string) => [
      ...new Set(rows.filter((r) => r.entityType === type && r.entityId).map((r) => r.entityId!)),
    ];
    const processIds = idsOf('process');
    const clientIds = idsOf('client');
    const [processes, clients] = await Promise.all([
      processIds.length
        ? this.supabase
            .from('processes')
            .select('id, cnj_number, internal_ref')
            .in('id', processIds)
        : Promise.resolve({ data: [] }),
      clientIds.length
        ? this.supabase.from('clients').select('id, name').in('id', clientIds)
        : Promise.resolve({ data: [] }),
    ]);
    const names = new Map<string, string>();
    for (const p of (processes.data ?? []) as {
      id: string;
      cnj_number: string | null;
      internal_ref: string | null;
    }[])
      names.set(p.id, p.cnj_number || p.internal_ref || '');
    for (const c of (clients.data ?? []) as { id: string; name: string }[]) names.set(c.id, c.name);
    for (const r of rows) r.entityName = (r.entityId && names.get(r.entityId)) || null;
  }
}
