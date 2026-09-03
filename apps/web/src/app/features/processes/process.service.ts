import { Injectable, inject } from '@angular/core';
import type { ProcessStatus } from '@juriflow/shared-types';
import { SUPABASE_CLIENT } from '../../core/supabase/supabase-client';
import { AuthService } from '../../core/auth/auth.service';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';
import type { Page } from '../clients/client.service';

export interface ProcessListRow {
  id: string;
  cnjNumber: string | null;
  internalRef: string | null;
  status: ProcessStatus;
  courtName: string;
  assignedName: string;
  createdAt: string;
}

export interface ProcessDetail {
  id: string;
  spaceId: string;
  cnjNumber: string | null;
  internalRef: string | null;
  courtId: string;
  courtName: string;
  status: ProcessStatus;
  assignedUserId: string;
  assignedName: string;
  createdBy: string;
  creatorName: string;
  createdAt: string;
}

export interface ProcessFilters {
  cnj?: string;
  internalRef?: string;
  courtId?: string;
  assignedUserId?: string;
  clientId?: string;
  status?: ProcessStatus | '';
  page?: number;
  pageSize?: number;
}

export interface ProcessInput {
  cnjNumber?: string | null;
  internalRef?: string | null;
  courtId: string;
  assignedUserId: string;
}

export interface LinkedClient {
  linkId: string;
  clientId: string;
  name: string;
  type: 'PF' | 'PJ';
  document: string | null;
}

export interface HistoryRow {
  id: string;
  responsibleId: string;
  responsibleName: string;
  assignedByName: string | null;
  reason: 'process_created' | 'transfer';
  startedAt: string;
  endedAt: string | null;
}

const SELECT_NAMES =
  '*, courts(name), assigned:profiles!processes_assigned_user_id_fkey(full_name,email), creator:profiles!processes_created_by_fkey(full_name,email)';

type NameRef = { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null;
const displayName = (n: NameRef): string => {
  const p = Array.isArray(n) ? n[0] : n;
  return p?.full_name || p?.email || '—';
};
const courtName = (c: { name: string } | { name: string }[] | null): string =>
  (Array.isArray(c) ? c[0]?.name : c?.name) ?? '—';

const DEFAULT_PAGE_SIZE = 20;

@Injectable({ providedIn: 'root' })
export class ProcessService {
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly auth = inject(AuthService);
  private readonly activeSpace = inject(ActiveSpaceService);

  private spaceId(): string {
    const id = this.activeSpace.activeSpaceId();
    if (!id) throw new Error('Nenhum espaço ativo.');
    return id;
  }

  async list(filters: ProcessFilters = {}): Promise<Page<ProcessListRow>> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
    const from = (page - 1) * pageSize;

    let processIds: string[] | null = null;
    if (filters.clientId) {
      const { data, error } = await this.supabase
        .from('process_clients')
        .select('process_id')
        .eq('client_id', filters.clientId)
        .is('deleted_at', null);
      if (error) throw error;
      processIds = (data ?? []).map((r: { process_id: string }) => r.process_id);
      if (processIds.length === 0) return { rows: [], total: 0, page, pageSize };
    }

    let q = this.supabase
      .from('processes')
      .select(SELECT_NAMES, { count: 'exact' })
      .eq('space_id', this.spaceId())
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (processIds) q = q.in('id', processIds);
    if (filters.cnj?.trim()) q = q.ilike('cnj_number', `%${filters.cnj.trim()}%`);
    if (filters.internalRef?.trim()) q = q.ilike('internal_ref', `%${filters.internalRef.trim()}%`);
    if (filters.courtId) q = q.eq('court_id', filters.courtId);
    if (filters.assignedUserId) q = q.eq('assigned_user_id', filters.assignedUserId);
    if (filters.status) q = q.eq('status', filters.status);

    const { data, error, count } = await q;
    if (error) throw error;

    const rows: ProcessListRow[] = (data ?? []).map((r: Record<string, unknown>) => ({
      id: r['id'] as string,
      cnjNumber: (r['cnj_number'] as string) ?? null,
      internalRef: (r['internal_ref'] as string) ?? null,
      status: r['status'] as ProcessStatus,
      courtName: courtName(r['courts'] as never),
      assignedName: displayName(r['assigned'] as NameRef),
      createdAt: r['created_at'] as string,
    }));
    return { rows, total: count ?? 0, page, pageSize };
  }

  async getById(id: string): Promise<ProcessDetail | null> {
    const { data, error } = await this.supabase.from('processes').select(SELECT_NAMES).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const r = data as Record<string, unknown>;
    return {
      id: r['id'] as string,
      spaceId: r['space_id'] as string,
      cnjNumber: (r['cnj_number'] as string) ?? null,
      internalRef: (r['internal_ref'] as string) ?? null,
      courtId: r['court_id'] as string,
      courtName: courtName(r['courts'] as never),
      status: r['status'] as ProcessStatus,
      assignedUserId: r['assigned_user_id'] as string,
      assignedName: displayName(r['assigned'] as NameRef),
      createdBy: r['created_by'] as string,
      creatorName: displayName(r['creator'] as NameRef),
      createdAt: r['created_at'] as string,
    };
  }

  async create(input: ProcessInput): Promise<{ id: string }> {
    const { data, error } = await this.supabase
      .from('processes')
      .insert({
        space_id: this.spaceId(),
        created_by: this.auth.userId(),
        assigned_user_id: input.assignedUserId,
        court_id: input.courtId,
        cnj_number: input.cnjNumber?.trim() || null,
        internal_ref: input.internalRef?.trim() || null,
      })
      .select('id')
      .single();
    if (error) throw error;
    return { id: (data as { id: string }).id };
  }

  async updateCore(id: string, patch: { cnjNumber?: string | null; internalRef?: string | null }): Promise<void> {
    const row: Record<string, unknown> = {};
    if (patch.cnjNumber !== undefined) row['cnj_number'] = patch.cnjNumber?.trim() || null;
    if (patch.internalRef !== undefined) row['internal_ref'] = patch.internalRef?.trim() || null;
    const { error } = await this.supabase.from('processes').update(row).eq('id', id);
    if (error) throw error;
  }

  async setCourt(id: string, courtId: string): Promise<void> {
    const { error } = await this.supabase.from('processes').update({ court_id: courtId }).eq('id', id);
    if (error) throw error;
  }

  async setStatus(id: string, status: ProcessStatus): Promise<void> {
    const { error } = await this.supabase.from('processes').update({ status }).eq('id', id);
    if (error) throw error;
  }

  async transfer(id: string, newAssignedUserId: string): Promise<void> {
    const { error } = await this.supabase.rpc('transfer_process', {
      p_process_id: id,
      p_new_assigned_user_id: newAssignedUserId,
    });
    if (error) throw error;
  }

  async softDelete(id: string): Promise<void> {
    const { error } = await this.supabase.rpc('soft_delete_process', { p_process_id: id });
    if (error) throw error;
  }

  async listClients(processId: string): Promise<LinkedClient[]> {
    const { data, error } = await this.supabase
      .from('process_clients')
      .select('id, client_id, clients(name, type, document)')
      .eq('process_id', processId)
      .is('deleted_at', null);
    if (error) throw error;
    return (data ?? []).map((r: Record<string, unknown>) => {
      const c = (Array.isArray(r['clients']) ? r['clients'][0] : r['clients']) as
        | { name: string; type: 'PF' | 'PJ'; document: string | null }
        | undefined;
      return {
        linkId: r['id'] as string,
        clientId: r['client_id'] as string,
        name: c?.name ?? '—',
        type: c?.type ?? 'PF',
        document: c?.document ?? null,
      };
    });
  }

  async attachClient(processId: string, clientId: string): Promise<void> {
    const { error } = await this.supabase
      .from('process_clients')
      .insert({ process_id: processId, client_id: clientId, created_by: this.auth.userId() });
    if (error) throw error;
  }

  async detachClient(linkId: string): Promise<void> {
    const { error } = await this.supabase
      .from('process_clients')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', linkId);
    if (error) throw error;
  }

  async history(processId: string): Promise<HistoryRow[]> {
    const { data, error } = await this.supabase
      .from('process_responsible_history')
      .select(
        'id, reason, started_at, ended_at, responsible:profiles!process_responsible_history_responsible_id_fkey(full_name,email), assigner:profiles!process_responsible_history_assigned_by_fkey(full_name,email)',
      )
      .eq('process_id', processId)
      .order('started_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r: Record<string, unknown>) => ({
      id: r['id'] as string,
      responsibleId: '',
      responsibleName: displayName(r['responsible'] as NameRef),
      assignedByName: r['assigner'] ? displayName(r['assigner'] as NameRef) : null,
      reason: r['reason'] as 'process_created' | 'transfer',
      startedAt: r['started_at'] as string,
      endedAt: (r['ended_at'] as string) ?? null,
    }));
  }
}
