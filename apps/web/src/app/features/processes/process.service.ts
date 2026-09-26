import { Injectable, inject } from '@angular/core';
import type { ProcessStatus } from '@juriflow/shared-types';
import { SUPABASE_CLIENT } from '../../core/supabase/supabase-client';
import { AuthService } from '../../core/auth/auth.service';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';
import type { Page } from '../clients/client.service';
import { likeContains } from '../../core/data/like';

export interface ProcessListRow {
  id: string;
  cnjNumber: string | null;
  internalRef: string | null;
  status: ProcessStatus;
  courtName: string;
  /** Nomes dos responsáveis atuais, separados por vírgula. */
  responsibleNames: string;
  createdAt: string;
}

export interface Responsible {
  profileId: string;
  name: string;
}

export interface DeletedProcessRow {
  id: string;
  cnjNumber: string | null;
  internalRef: string | null;
  courtName: string;
  deletedAt: string;
}

export interface PlanUsage {
  maxProcesses: number;
  usedProcesses: number;
  maxTracked: number;
  usedTracked: number;
}

export interface ProcessDetail {
  id: string;
  spaceId: string;
  cnjNumber: string | null;
  internalRef: string | null;
  courtId: string;
  courtName: string;
  status: ProcessStatus;
  responsibles: Responsible[];
  createdBy: string;
  creatorName: string;
  createdAt: string;
  /** Acompanhamento (worker): coleta automática e "consultar agora". */
  trackingEnabled: boolean;
  courtTracked: boolean;
  lastCheckedAt: string | null;
  lastCheckError: string | null;
  checkRequestedAt: string | null;
}

export interface DeliveryRow {
  id: string;
  recipientType: 'responsible' | 'client';
  recipientName: string;
  phone: string;
  status: 'sent' | 'failed';
  error: string | null;
  movementDescription: string;
  at: string;
}

/**
 * Abas da lista: `mine` = processos em que o usuário é responsável; `all` =
 * todos do espaço (só ADMIN — para o colaborador a RLS já devolve só os dele);
 * `archived` = arquivados. Excluídos têm listagem própria (listDeleted).
 */
export type ProcessScope = 'mine' | 'all' | 'archived';

export interface ProcessFilters {
  scope?: ProcessScope;
  cnj?: string;
  internalRef?: string;
  courtId?: string;
  responsibleId?: string;
  clientId?: string;
  status?: ProcessStatus | '';
  page?: number;
  pageSize?: number;
}

export interface ProcessInput {
  cnjNumber?: string | null;
  internalRef?: string | null;
  courtId: string;
  /** Só o ADMIN informa; para o colaborador o banco usa ele mesmo. */
  responsibleIds?: string[];
}

export interface LinkedClient {
  linkId: string;
  clientId: string;
  name: string;
  type: 'PF' | 'PJ';
  document: string | null;
}

export interface MovementRow {
  id: string;
  description: string;
  occurredAt: string | null;
  collectedAt: string;
  sourceKind: string;
}

export interface HistoryRow {
  id: string;
  responsibleId: string;
  responsibleName: string;
  assignedByName: string | null;
  reason: 'process_created' | 'transfer' | 'added';
  startedAt: string;
  endedAt: string | null;
}

const RESPONSIBLES_EMBED =
  'resp:process_responsible_history(responsible_id, ended_at, profile:profiles!process_responsible_history_responsible_id_fkey(full_name,email))';

const SELECT_NAMES = `*, courts(name, tracking_source_kind), creator:profiles!processes_created_by_fkey(full_name,email), ${RESPONSIBLES_EMBED}`;

type ResponsibleRef = { responsible_id: string; ended_at: string | null; profile: NameRef };

type NameRef =
  | { full_name: string | null; email: string }
  | { full_name: string | null; email: string }[]
  | null;
const displayName = (n: NameRef): string => {
  const p = Array.isArray(n) ? n[0] : n;
  return p?.full_name || p?.email || '—';
};
type CourtRef =
  | { name: string; tracking_source_kind?: string | null }
  | { name: string; tracking_source_kind?: string | null }[]
  | null;
const courtOf = (c: CourtRef) => (Array.isArray(c) ? c[0] : c) ?? null;
const courtName = (c: CourtRef): string => courtOf(c)?.name ?? '—';

/** Responsáveis atuais = períodos ainda abertos. */
const currentResponsibles = (rows: ResponsibleRef[] | null | undefined): Responsible[] =>
  (rows ?? [])
    .filter((r) => !r.ended_at)
    .map((r) => ({ profileId: r.responsible_id, name: displayName(r.profile) }));

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

    // Filtrar por responsável exige um embed `!inner` separado do que só exibe
    // os nomes (senão a lista mostraria só o responsável filtrado).
    const filterBy =
      filters.scope === 'mine' ? this.auth.userId() : (filters.responsibleId ?? null);
    // string explícita: o parser de tipos do supabase-js não lida com select montado.
    const select: string = filterBy
      ? `${SELECT_NAMES}, filtro:process_responsible_history!inner(responsible_id, ended_at)`
      : SELECT_NAMES;

    let q = this.supabase
      .from('processes')
      .select(select, { count: 'exact' })
      .eq('space_id', this.spaceId())
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (filterBy) q = q.eq('filtro.responsible_id', filterBy).is('filtro.ended_at', null);
    if (filters.scope === 'archived') q = q.eq('status', 'archived');
    else if (filters.status) q = q.eq('status', filters.status);
    else if (filters.scope) q = q.neq('status', 'archived');
    if (processIds) q = q.in('id', processIds);
    if (filters.cnj?.trim()) q = q.ilike('cnj_number', likeContains(filters.cnj));
    if (filters.internalRef?.trim()) q = q.ilike('internal_ref', likeContains(filters.internalRef));
    if (filters.courtId) q = q.eq('court_id', filters.courtId);

    const { data, error, count } = await q;
    if (error) throw error;

    const rows: ProcessListRow[] = ((data ?? []) as unknown as Record<string, unknown>[]).map(
      (r) => ({
        id: r['id'] as string,
        cnjNumber: (r['cnj_number'] as string) ?? null,
        internalRef: (r['internal_ref'] as string) ?? null,
        status: r['status'] as ProcessStatus,
        courtName: courtName(r['courts'] as never),
        responsibleNames:
          currentResponsibles(r['resp'] as ResponsibleRef[])
            .map((x) => x.name)
            .join(', ') || '—',
        createdAt: r['created_at'] as string,
      }),
    );
    return { rows, total: count ?? 0, page, pageSize };
  }

  async getById(id: string): Promise<ProcessDetail | null> {
    const { data, error } = await this.supabase
      .from('processes')
      .select(SELECT_NAMES)
      .eq('id', id)
      .maybeSingle();
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
      responsibles: currentResponsibles(r['resp'] as ResponsibleRef[]),
      createdBy: r['created_by'] as string,
      creatorName: displayName(r['creator'] as NameRef),
      createdAt: r['created_at'] as string,
      trackingEnabled: (r['tracking_enabled'] as boolean) ?? true,
      courtTracked: !!courtOf(r['courts'] as CourtRef)?.tracking_source_kind,
      lastCheckedAt: (r['last_checked_at'] as string) ?? null,
      lastCheckError: (r['last_check_error'] as string) ?? null,
      checkRequestedAt: (r['check_requested_at'] as string) ?? null,
    };
  }

  /** Estado de acompanhamento, sem os joins — usado no polling de "consultar agora". */
  async trackingState(
    id: string,
  ): Promise<Pick<ProcessDetail, 'lastCheckedAt' | 'lastCheckError' | 'checkRequestedAt'>> {
    const { data, error } = await this.supabase
      .from('processes')
      .select('last_checked_at, last_check_error, check_requested_at')
      .eq('id', id)
      .single();
    if (error) throw error;
    const r = data as Record<string, string | null>;
    return {
      lastCheckedAt: r['last_checked_at'] ?? null,
      lastCheckError: r['last_check_error'] ?? null,
      checkRequestedAt: r['check_requested_at'] ?? null,
    };
  }

  /** "Consultar agora" (RN seção 39): grava o pedido; o worker coleta e limpa. */
  async requestCheck(id: string): Promise<void> {
    const { error } = await this.supabase.rpc('request_process_check', { p_process_id: id });
    if (error) throw error;
  }

  /** Histórico de envios de WhatsApp deste processo (notification_deliveries). */
  async deliveries(processId: string): Promise<DeliveryRow[]> {
    const { data, error } = await this.supabase
      .from('notification_deliveries')
      .select(
        'id, recipient_type, phone, status, error, sent_at, created_at, clients(name), process_movements(description)',
      )
      .eq('process_id', processId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
    return (data ?? []).map((r: Record<string, unknown>) => ({
      id: r['id'] as string,
      recipientType: r['recipient_type'] as 'responsible' | 'client',
      recipientName:
        r['recipient_type'] === 'responsible'
          ? 'Responsável'
          : (one(r['clients'] as { name: string } | null)?.name ?? 'Cliente'),
      phone: r['phone'] as string,
      status: r['status'] as 'sent' | 'failed',
      error: (r['error'] as string) ?? null,
      movementDescription:
        one(r['process_movements'] as { description: string } | null)?.description ?? '—',
      at: ((r['sent_at'] as string) ?? r['created_at']) as string,
    }));
  }

  /** Cadastro atômico (processo + responsáveis) e sujeito ao limite do plano. */
  async create(input: ProcessInput): Promise<{ id: string }> {
    const { data, error } = await this.supabase.rpc('create_process', {
      p_space_id: this.spaceId(),
      p_court_id: input.courtId,
      p_cnj_number: input.cnjNumber?.trim() || null,
      p_internal_ref: input.internalRef?.trim() || null,
      p_responsible_ids: input.responsibleIds?.length ? input.responsibleIds : null,
    });
    if (error) throw error;
    return { id: data as string };
  }

  async planUsage(): Promise<PlanUsage> {
    const { data, error } = await this.supabase
      .rpc('space_plan_usage', { p_space_id: this.spaceId() })
      .single();
    if (error) throw error;
    const r = data as Record<string, number>;
    return {
      maxProcesses: r['max_processes'] ?? 0,
      usedProcesses: r['used_processes'] ?? 0,
      maxTracked: r['max_tracked_processes'] ?? 0,
      usedTracked: r['used_tracked'] ?? 0,
    };
  }

  /** Liga/desliga a sincronização automática (sujeito ao limite do plano). */
  async setTracking(id: string, enabled: boolean): Promise<void> {
    const { error } = await this.supabase
      .from('processes')
      .update({ tracking_enabled: enabled })
      .eq('id', id);
    if (error) throw error;
  }

  async updateCore(
    id: string,
    patch: { cnjNumber?: string | null; internalRef?: string | null },
  ): Promise<void> {
    const row: Record<string, unknown> = {};
    if (patch.cnjNumber !== undefined) row['cnj_number'] = patch.cnjNumber?.trim() || null;
    if (patch.internalRef !== undefined) row['internal_ref'] = patch.internalRef?.trim() || null;
    const { error } = await this.supabase.from('processes').update(row).eq('id', id);
    if (error) throw error;
  }

  async setCourt(id: string, courtId: string): Promise<void> {
    const { error } = await this.supabase
      .from('processes')
      .update({ court_id: courtId })
      .eq('id', id);
    if (error) throw error;
  }

  async setStatus(id: string, status: ProcessStatus): Promise<void> {
    const { error } = await this.supabase.from('processes').update({ status }).eq('id', id);
    if (error) throw error;
  }

  async addResponsible(id: string, profileId: string): Promise<void> {
    const { error } = await this.supabase.rpc('add_process_responsible', {
      p_process_id: id,
      p_profile_id: profileId,
    });
    if (error) throw error;
  }

  async removeResponsible(id: string, profileId: string): Promise<void> {
    const { error } = await this.supabase.rpc('remove_process_responsible', {
      p_process_id: id,
      p_profile_id: profileId,
    });
    if (error) throw error;
  }

  /** Só ADMIN e só processo arquivado (regra no banco). */
  async softDelete(id: string): Promise<void> {
    const { error } = await this.supabase.rpc('soft_delete_process', { p_process_id: id });
    if (error) throw error;
  }

  async restore(id: string): Promise<void> {
    const { error } = await this.supabase.rpc('restore_process', { p_process_id: id });
    if (error) throw error;
  }

  async listDeleted(): Promise<DeletedProcessRow[]> {
    const { data, error } = await this.supabase.rpc('list_deleted_processes', {
      p_space_id: this.spaceId(),
    });
    if (error) throw error;
    return ((data ?? []) as Record<string, string | null>[]).map((r) => ({
      id: r['id'] as string,
      cnjNumber: r['cnj_number'] ?? null,
      internalRef: r['internal_ref'] ?? null,
      courtName: r['court_name'] ?? '—',
      deletedAt: r['deleted_at'] as string,
    }));
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
        { name: string; type: 'PF' | 'PJ'; document: string | null } | undefined;
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

  /** RN seção 46: mais recente primeiro, distinguindo quando ocorreu de quando foi coletada. */
  async movements(processId: string): Promise<MovementRow[]> {
    const { data, error } = await this.supabase
      .from('process_movements')
      .select('id, description, occurred_at, collected_at, source_kind')
      .eq('process_id', processId)
      .order('occurred_at', { ascending: false, nullsFirst: false })
      .order('collected_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    return (data ?? []).map((r: Record<string, unknown>) => ({
      id: r['id'] as string,
      description: r['description'] as string,
      occurredAt: (r['occurred_at'] as string) ?? null,
      collectedAt: r['collected_at'] as string,
      sourceKind: r['source_kind'] as string,
    }));
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
      reason: r['reason'] as HistoryRow['reason'],
      startedAt: r['started_at'] as string,
      endedAt: (r['ended_at'] as string) ?? null,
    }));
  }
}
