import { Injectable, inject } from '@angular/core';
import { SUPABASE_CLIENT } from '../../core/supabase/supabase-client';
import type { Page } from '../clients/client.service';

export interface CourtStrategy {
  sourceKind: string;
  priority: number;
  requiresCnj: boolean;
}

export interface TrackingConfigView {
  sourceKind: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  consecutiveFailures: number;
  pausedAt: string | null;
  pauseReason: string | null;
  nextRunAt: string | null;
  lastErrorCode: string | null;
}

export interface MovementView {
  id: string;
  occurredAt: string | null;
  collectedAt: string;
  categoryLabel: string | null;
  description: string;
  needsReview: boolean;
  isFirstSync: boolean;
  sourceKind: string;
}

@Injectable({ providedIn: 'root' })
export class TrackingService {
  private readonly supabase = inject(SUPABASE_CLIENT);

  async listStrategies(courtId: string): Promise<CourtStrategy[]> {
    const { data, error } = await this.supabase
      .from('court_tracking_strategies')
      .select('source_kind, priority, requires_cnj')
      .eq('court_id', courtId)
      .eq('enabled', true)
      .order('priority');
    if (error) throw error;
    return (data ?? []).map((r: Record<string, unknown>) => ({
      sourceKind: r['source_kind'] as string,
      priority: r['priority'] as number,
      requiresCnj: r['requires_cnj'] as boolean,
    }));
  }

  async getConfigs(processId: string): Promise<TrackingConfigView[]> {
    const [{ data: configs, error: cErr }, { data: runs, error: rErr }] = await Promise.all([
      this.supabase
        .from('process_tracking_configs')
        .select(
          'source_kind, enabled, last_run_at, last_run_status, consecutive_failures, paused_at, pause_reason, next_run_at',
        )
        .eq('process_id', processId),
      this.supabase
        .from('collection_runs')
        .select('source_kind, status, error_code, created_at')
        .eq('process_id', processId)
        .order('created_at', { ascending: false }),
    ]);
    if (cErr) throw cErr;
    if (rErr) throw rErr;

    const lastErrBySource = new Map<string, string | null>();
    for (const run of (runs ?? []) as Record<string, unknown>[]) {
      const s = run['source_kind'] as string;
      if (!lastErrBySource.has(s)) {
        lastErrBySource.set(s, run['status'] === 'failed' ? ((run['error_code'] as string) ?? null) : null);
      }
    }

    return ((configs ?? []) as Record<string, unknown>[]).map((c) => ({
      sourceKind: c['source_kind'] as string,
      enabled: c['enabled'] as boolean,
      lastRunAt: (c['last_run_at'] as string) ?? null,
      lastRunStatus: (c['last_run_status'] as string) ?? null,
      consecutiveFailures: (c['consecutive_failures'] as number) ?? 0,
      pausedAt: (c['paused_at'] as string) ?? null,
      pauseReason: (c['pause_reason'] as string) ?? null,
      nextRunAt: (c['next_run_at'] as string) ?? null,
      lastErrorCode: lastErrBySource.get(c['source_kind'] as string) ?? null,
    }));
  }

  async setEnabled(processId: string, sourceKind: string, enabled: boolean): Promise<void> {
    const { error } = await this.supabase.rpc('set_process_tracking', {
      p_process_id: processId,
      p_source_kind: sourceKind,
      p_enabled: enabled,
    });
    if (error) throw error;
  }

  async collectNow(processId: string, sourceKind: string): Promise<void> {
    const { error } = await this.supabase.rpc('collect_process_now', {
      p_process_id: processId,
      p_source_kind: sourceKind,
    });
    if (error) throw error;
  }

  async listMovements(
    processId: string,
    opts: { page?: number; pageSize?: number } = {},
  ): Promise<Page<MovementView>> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = opts.pageSize ?? 20;
    const from = (page - 1) * pageSize;
    const { data, error, count } = await this.supabase
      .from('process_movements')
      .select('id, occurred_at, collected_at, category_label, description, needs_review, is_first_sync, source_kind', {
        count: 'exact',
      })
      .eq('process_id', processId)
      .order('occurred_at', { ascending: false, nullsFirst: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    return {
      rows: ((data ?? []) as Record<string, unknown>[]).map((m) => ({
        id: m['id'] as string,
        occurredAt: (m['occurred_at'] as string) ?? null,
        collectedAt: m['collected_at'] as string,
        categoryLabel: (m['category_label'] as string) ?? null,
        description: (m['description'] as string) ?? '',
        needsReview: m['needs_review'] as boolean,
        isFirstSync: m['is_first_sync'] as boolean,
        sourceKind: m['source_kind'] as string,
      })),
      total: count ?? 0,
      page,
      pageSize,
    };
  }
}
