import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ProcessRepository,
  TrackableProcess,
  TrackingStateUpdate,
} from '../ports/process-repository.port.js';

interface ProcessRow {
  id: string;
  space_id: string;
  cnj_number: string | null;
  court_id: string;
  last_state_hash: string | null;
  courts: { tracking_source_kind: string | null } | null;
}

const SELECT_COLUMNS =
  'id, space_id, cnj_number, court_id, last_state_hash, courts!inner(tracking_source_kind)';

function toTrackable(row: ProcessRow): TrackableProcess | null {
  const sourceKind = row.courts?.tracking_source_kind;
  if (!row.cnj_number || !sourceKind) return null;
  return {
    id: row.id,
    spaceId: row.space_id,
    cnjNumber: row.cnj_number,
    courtId: row.court_id,
    sourceKind,
    lastStateHash: row.last_state_hash,
  };
}

export class SupabaseProcessRepository implements ProcessRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listTrackableProcesses(): Promise<TrackableProcess[]> {
    const { data, error } = await this.client
      .from('processes')
      .select(SELECT_COLUMNS)
      .eq('status', 'active')
      .eq('tracking_enabled', true)
      .is('deleted_at', null)
      .not('cnj_number', 'is', null)
      .not('courts.tracking_source_kind', 'is', null)
      .returns<ProcessRow[]>();

    if (error) throw new Error(`Falha ao listar processos rastreáveis: ${error.message}`);
    return (data ?? []).map(toTrackable).filter((p): p is TrackableProcess => p !== null);
  }

  async findTrackableProcessById(processId: string): Promise<TrackableProcess | null> {
    const { data, error } = await this.client
      .from('processes')
      .select(SELECT_COLUMNS)
      .eq('id', processId)
      .is('deleted_at', null)
      .maybeSingle<ProcessRow>();

    if (error) throw new Error(`Falha ao buscar processo ${processId}: ${error.message}`);
    return data ? toTrackable(data) : null;
  }

  async updateTrackingState(processId: string, update: TrackingStateUpdate): Promise<void> {
    const { error } = await this.client
      .from('processes')
      .update({
        last_state_hash: update.lastStateHash,
        last_checked_at: update.lastCheckedAt.toISOString(),
        last_check_error: update.lastCheckError,
      })
      .eq('id', processId);

    if (error)
      throw new Error(
        `Falha ao atualizar estado de tracking do processo ${processId}: ${error.message}`,
      );
  }
}
