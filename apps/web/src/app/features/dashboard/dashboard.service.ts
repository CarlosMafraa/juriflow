import { Injectable, inject } from '@angular/core';
import { SUPABASE_CLIENT } from '../../core/supabase/supabase-client';

export interface PlatformMetrics {
  activeSpaces: number;
  suspendedSpaces: number;
  users: number;
}

export interface DashboardMetrics {
  activeProcesses: number;
  archivedProcesses: number;
  movementsLast7Days: number;
  notificationsSent30Days: number;
  notificationsFailed30Days: number;
  processesWithCheckError: number;
}

export interface RecentMovement {
  id: string;
  processId: string;
  processLabel: string;
  description: string;
  occurredAt: string | null;
  collectedAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Indicadores do espaço ativo. Tudo sob RLS: o COLABORADOR vê só os números
 * dos processos pelos quais responde; o ADMIN, do espaço inteiro. Contagens
 * com `head: true` — o banco devolve só o total, sem trafegar linhas.
 */
@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly supabase = inject(SUPABASE_CLIENT);

  async metrics(spaceId: string): Promise<DashboardMetrics> {
    const since7 = new Date(Date.now() - 7 * DAY_MS).toISOString();
    const since30 = new Date(Date.now() - 30 * DAY_MS).toISOString();

    const count = async (query: PromiseLike<{ count: number | null; error: unknown }>) => {
      const { count: total, error } = await query;
      if (error) throw error;
      return total ?? 0;
    };

    const activeProcesses = () =>
      this.supabase
        .from('processes')
        .select('id', { count: 'exact', head: true })
        .eq('space_id', spaceId)
        .eq('status', 'active')
        .is('deleted_at', null);

    const [active, archived, movements, sent, failed, checkErrors] = await Promise.all([
      count(activeProcesses()),
      count(
        this.supabase
          .from('processes')
          .select('id', { count: 'exact', head: true })
          .eq('space_id', spaceId)
          .eq('status', 'archived'),
      ),
      count(
        this.supabase
          .from('process_movements')
          .select('id', { count: 'exact', head: true })
          .eq('space_id', spaceId)
          .gte('collected_at', since7),
      ),
      count(
        this.supabase
          .from('notification_deliveries')
          .select('id', { count: 'exact', head: true })
          .eq('space_id', spaceId)
          .eq('status', 'sent')
          .gte('created_at', since30),
      ),
      count(
        this.supabase
          .from('notification_deliveries')
          .select('id', { count: 'exact', head: true })
          .eq('space_id', spaceId)
          .eq('status', 'failed')
          .gte('created_at', since30),
      ),
      count(activeProcesses().not('last_check_error', 'is', null)),
    ]);

    return {
      activeProcesses: active,
      archivedProcesses: archived,
      movementsLast7Days: movements,
      notificationsSent30Days: sent,
      notificationsFailed30Days: failed,
      processesWithCheckError: checkErrors,
    };
  }

  /** Visão da plataforma: só quantidades — nada de dentro dos espaços. */
  async platformMetrics(): Promise<PlatformMetrics> {
    const [spaces, users] = await Promise.all([
      this.supabase.from('spaces').select('status'),
      this.supabase.from('profiles').select('id', { count: 'exact', head: true }),
    ]);
    if (spaces.error) throw spaces.error;
    if (users.error) throw users.error;
    const rows = (spaces.data ?? []) as { status: string }[];
    return {
      activeSpaces: rows.filter((r) => r.status === 'active').length,
      suspendedSpaces: rows.filter((r) => r.status === 'suspended').length,
      users: users.count ?? 0,
    };
  }

  async recentMovements(spaceId: string, limit = 6): Promise<RecentMovement[]> {
    const { data, error } = await this.supabase
      .from('process_movements')
      .select(
        'id, process_id, description, occurred_at, collected_at, processes(cnj_number, internal_ref)',
      )
      .eq('space_id', spaceId)
      .order('collected_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((r: Record<string, unknown>) => {
      const raw = r['processes'] as
        | { cnj_number: string | null; internal_ref: string | null }
        | { cnj_number: string | null; internal_ref: string | null }[]
        | null;
      const proc = Array.isArray(raw) ? raw[0] : raw;
      return {
        id: r['id'] as string,
        processId: r['process_id'] as string,
        processLabel: proc?.cnj_number || proc?.internal_ref || 'Processo',
        description: r['description'] as string,
        occurredAt: (r['occurred_at'] as string) ?? null,
        collectedAt: r['collected_at'] as string,
      };
    });
  }
}
