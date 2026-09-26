import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkerStatusReporter } from '../ports/worker-status.port.js';

/** Grava em `worker_status` (0044); a plataforma lê por `platform_worker_status()`. */
export class SupabaseWorkerStatus implements WorkerStatusReporter {
  private readonly startedAt = new Date().toISOString();

  constructor(
    private readonly client: SupabaseClient,
    private readonly worker = 'scraper-worker',
  ) {}

  heartbeat(): Promise<void> {
    return this.upsert({ started_at: this.startedAt, last_seen_at: new Date().toISOString() });
  }

  sourceSucceeded(): Promise<void> {
    const now = new Date().toISOString();
    return this.upsert({ last_seen_at: now, last_source_ok_at: now });
  }

  sourceFailed(error: string): Promise<void> {
    const now = new Date().toISOString();
    return this.upsert({
      last_seen_at: now,
      last_source_error: error.slice(0, 500),
      last_source_error_at: now,
    });
  }

  private async upsert(fields: Record<string, string>): Promise<void> {
    const { error } = await this.client
      .from('worker_status')
      .upsert({ worker: this.worker, ...fields }, { onConflict: 'worker' });
    if (error) throw new Error(`Falha ao gravar a saúde do worker: ${error.message}`);
  }
}
