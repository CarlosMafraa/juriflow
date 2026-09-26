import { Injectable, inject } from '@angular/core';
import { SUPABASE_CLIENT } from '../../core/supabase/supabase-client';

export interface PlatformMetrics {
  activeSpaces: number;
  suspendedSpaces: number;
  /** Escritórios cujo ADMIN ainda não completou a configuração. */
  pendingSetup: number;
  users: number;
}

export interface DashboardMetrics {
  activeProcesses: number;
  archivedProcesses: number;
  closedProcesses: number;
  /** Ativos com sincronização automática de fato (CNJ + tribunal com coleta). */
  trackedProcesses: number;
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

export interface DayPoint {
  /** AAAA-MM-DD, no fuso de Manaus. */
  day: string;
  total: number;
}

export interface GrowthPoint {
  /** AAAA-MM-01. */
  month: string;
  newSpaces: number;
  newUsers: number;
}

export interface PlanGroup {
  maxProcesses: number;
  maxTracked: number;
  spaces: number;
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

    const byStatus = (status: 'archived' | 'closed') =>
      this.supabase
        .from('processes')
        .select('id', { count: 'exact', head: true })
        .eq('space_id', spaceId)
        .eq('status', status);

    const [active, archived, closed, tracked, movements, sent, failed, checkErrors] =
      await Promise.all([
        count(activeProcesses()),
        count(byStatus('archived')),
        count(byStatus('closed')),
        // Mesma regra do plano: ativo, CNJ, sincronização ligada e tribunal com coleta.
        count(
          this.supabase
            .from('processes')
            .select('id, courts!inner(tracking_source_kind)', { count: 'exact', head: true })
            .eq('space_id', spaceId)
            .eq('status', 'active')
            .eq('tracking_enabled', true)
            .not('cnj_number', 'is', null)
            .not('courts.tracking_source_kind', 'is', null),
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
      closedProcesses: closed,
      trackedProcesses: tracked,
      movementsLast7Days: movements,
      notificationsSent30Days: sent,
      notificationsFailed30Days: failed,
      processesWithCheckError: checkErrors,
    };
  }

  /** Visão da plataforma: só quantidades — nada de dentro dos espaços. */
  async platformMetrics(): Promise<PlatformMetrics> {
    const { data, error } = await this.supabase.rpc('platform_overview').single();
    if (error) throw error;
    const r = data as Record<string, number>;
    return {
      activeSpaces: r['active_spaces'] ?? 0,
      suspendedSpaces: r['suspended_spaces'] ?? 0,
      pendingSetup: r['pending_setup'] ?? 0,
      users: r['users'] ?? 0,
    };
  }

  /** Movimentações por dia (RLS: o colaborador conta só os processos dele). */
  async movementsPerDay(spaceId: string, days = 30): Promise<DayPoint[]> {
    const { data, error } = await this.supabase.rpc('space_movements_per_day', {
      p_space_id: spaceId,
      p_days: days,
    });
    if (error) throw error;
    return ((data ?? []) as { day: string; total: number }[]).map((r) => ({
      day: r.day,
      total: r.total,
    }));
  }

  /** Novos espaços e novas contas por mês (só SUPER_ADMIN). */
  async platformGrowth(months = 6): Promise<GrowthPoint[]> {
    const { data, error } = await this.supabase.rpc('platform_growth', { p_months: months });
    if (error) throw error;
    return ((data ?? []) as { month: string; new_spaces: number; new_users: number }[]).map(
      (r) => ({
        month: r.month,
        newSpaces: r.new_spaces,
        newUsers: r.new_users,
      }),
    );
  }

  /** Quantos espaços em cada combinação de limites (plano), do menor ao maior. */
  async spacesByPlan(): Promise<PlanGroup[]> {
    const { data, error } = await this.supabase
      .from('spaces')
      .select('max_processes, max_tracked_processes');
    if (error) throw error;
    const groups = new Map<string, PlanGroup>();
    for (const r of (data ?? []) as { max_processes: number; max_tracked_processes: number }[]) {
      const key = `${r.max_processes}/${r.max_tracked_processes}`;
      const g = groups.get(key) ?? {
        maxProcesses: r.max_processes,
        maxTracked: r.max_tracked_processes,
        spaces: 0,
      };
      g.spaces += 1;
      groups.set(key, g);
    }
    return [...groups.values()].sort(
      (a, b) => a.maxProcesses - b.maxProcesses || a.maxTracked - b.maxTracked,
    );
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
