import type { SupabaseClient } from '@supabase/supabase-js';
import { mergeMovementTypeAudiences, type MovementTypeAudiences } from '../domain/movement-type.js';
import type { MovementTypePolicy } from '../ports/movement-type-policy.port.js';

interface TypeRow {
  name: string;
  notify_responsible: boolean;
  notify_client: boolean;
}

function toMap(rows: readonly TypeRow[]): Map<string, MovementTypeAudiences> {
  return new Map(
    rows.map((r) => [r.name, { responsible: r.notify_responsible, client: r.notify_client }]),
  );
}

export class SupabaseMovementTypePolicy implements MovementTypePolicy {
  constructor(private readonly client: SupabaseClient) {}

  async registerTypes(spaceId: string, types: readonly string[]): Promise<void> {
    const unique = [...new Set(types)];
    if (unique.length === 0) return;
    const { error } = await this.client.from('space_movement_types').upsert(
      unique.map((name) => ({ space_id: spaceId, name })),
      { onConflict: 'space_id,name', ignoreDuplicates: true },
    );
    if (error) throw new Error(`Falha ao registrar tipos de movimentação: ${error.message}`);
  }

  async resolve(
    processId: string,
    spaceId: string,
  ): Promise<(movementType: string | null) => MovementTypeAudiences> {
    const [space, process] = await Promise.all([
      this.client
        .from('space_movement_types')
        .select('name, notify_responsible, notify_client')
        .eq('space_id', spaceId)
        .returns<TypeRow[]>(),
      this.client
        .from('process_movement_type_prefs')
        .select('name, notify_responsible, notify_client')
        .eq('process_id', processId)
        .returns<TypeRow[]>(),
    ]);
    if (space.error) throw new Error(`Falha ao ler tipos do escritório: ${space.error.message}`);
    if (process.error)
      throw new Error(`Falha ao ler tipos do processo ${processId}: ${process.error.message}`);
    return mergeMovementTypeAudiences(toMap(space.data ?? []), toMap(process.data ?? []));
  }
}
