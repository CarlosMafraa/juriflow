import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  MovementRepository,
  MovementToInsert,
  StoredMovement,
} from '../ports/movement-repository.port.js';

interface MovementRow {
  id: string;
  content_hash: string;
  description: string;
  occurred_at: string | null;
  movement_type: string | null;
}

export class SupabaseMovementRepository implements MovementRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listKnownHashes(processId: string): Promise<ReadonlySet<string>> {
    const { data, error } = await this.client
      .from('process_movements')
      .select('content_hash')
      .eq('process_id', processId);

    if (error)
      throw new Error(
        `Falha ao ler movimentações conhecidas do processo ${processId}: ${error.message}`,
      );
    return new Set((data ?? []).map((row) => row.content_hash as string));
  }

  async getByIds(processId: string, ids: readonly string[]): Promise<StoredMovement[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.client
      .from('process_movements')
      .select('id, content_hash, description, occurred_at, movement_type')
      .eq('process_id', processId)
      .in('id', [...ids])
      .returns<MovementRow[]>();
    if (error)
      throw new Error(`Falha ao ler movimentações do processo ${processId}: ${error.message}`);
    return (data ?? []).map((row) => ({
      id: row.id,
      contentHash: row.content_hash,
      description: row.description,
      occurredAt: row.occurred_at,
      movementType: row.movement_type,
    }));
  }

  async insertNewMovements(
    processId: string,
    spaceId: string,
    movements: readonly MovementToInsert[],
  ): Promise<StoredMovement[]> {
    if (movements.length === 0) return [];

    const rows = movements.map((m) => ({
      space_id: spaceId,
      process_id: processId,
      source_kind: m.sourceKind,
      source_movement_id: m.sourceMovementId,
      description: m.description,
      movement_type: m.movementType,
      occurred_at: m.occurredAt,
      raw: m.raw ?? {},
      content_hash: m.contentHash,
    }));

    // ON CONFLICT DO NOTHING (unique: process_id, content_hash) — RN16.
    // RETURNING só traz as linhas de fato inseridas.
    const { data, error } = await this.client
      .from('process_movements')
      .upsert(rows, { onConflict: 'process_id,content_hash', ignoreDuplicates: true })
      .select('id, content_hash, description, occurred_at, movement_type')
      .returns<MovementRow[]>();

    if (error)
      throw new Error(`Falha ao inserir movimentações do processo ${processId}: ${error.message}`);
    return (data ?? []).map((row) => ({
      id: row.id,
      contentHash: row.content_hash,
      description: row.description,
      occurredAt: row.occurred_at,
      movementType: row.movement_type,
    }));
  }
}
