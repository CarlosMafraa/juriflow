import { Injectable, inject } from '@angular/core';
import { SUPABASE_CLIENT } from '../../core/supabase/supabase-client';
import { AuthService } from '../../core/auth/auth.service';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';

interface TypeRow {
  name: string;
  notify_responsible: boolean;
  notify_client: boolean;
}

/** Tipo de movimentação com os toggles de aviso. */
export interface MovementTypeToggles {
  name: string;
  responsible: boolean;
  client: boolean;
  /** Só no processo: true = personalizado aqui; false = segue o padrão do escritório. */
  customized?: boolean;
}

function byName(a: TypeRow, b: TypeRow): number {
  return a.name.localeCompare(b.name, 'pt-BR');
}

/**
 * Filtro de notificação por tipo de movimentação (regras N5/N6): padrão do
 * escritório em `space_movement_types` (só ADMIN altera) e personalização por
 * processo em `process_movement_type_prefs` (ADMIN ou responsável).
 */
@Injectable({ providedIn: 'root' })
export class MovementTypeService {
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly auth = inject(AuthService);
  private readonly activeSpace = inject(ActiveSpaceService);

  private spaceId(): string {
    const id = this.activeSpace.activeSpaceId();
    if (!id) throw new Error('Nenhum espaço ativo.');
    return id;
  }

  private async spaceRows(): Promise<TypeRow[]> {
    const { data, error } = await this.supabase
      .from('space_movement_types')
      .select('name, notify_responsible, notify_client')
      .eq('space_id', this.spaceId());
    if (error) throw error;
    return ((data ?? []) as TypeRow[]).sort(byName);
  }

  async listForSpace(): Promise<MovementTypeToggles[]> {
    return (await this.spaceRows()).map((r) => ({
      name: r.name,
      responsible: r.notify_responsible,
      client: r.notify_client,
    }));
  }

  async setForSpace(name: string, responsible: boolean, client: boolean): Promise<void> {
    const { error } = await this.supabase
      .from('space_movement_types')
      .update({
        notify_responsible: responsible,
        notify_client: client,
        updated_by: this.auth.userId(),
      })
      .eq('space_id', this.spaceId())
      .eq('name', name);
    if (error) throw error;
  }

  async listForProcess(processId: string): Promise<MovementTypeToggles[]> {
    const [space, prefs] = await Promise.all([
      this.spaceRows(),
      this.supabase
        .from('process_movement_type_prefs')
        .select('name, notify_responsible, notify_client')
        .eq('process_id', processId),
    ]);
    if (prefs.error) throw prefs.error;
    const custom = new Map(((prefs.data ?? []) as TypeRow[]).map((r) => [r.name, r]));
    return space.map((r) => {
      const own = custom.get(r.name);
      return {
        name: r.name,
        responsible: (own ?? r).notify_responsible,
        client: (own ?? r).notify_client,
        customized: Boolean(own),
      };
    });
  }

  async setForProcess(
    processId: string,
    name: string,
    responsible: boolean,
    client: boolean,
  ): Promise<void> {
    const { error } = await this.supabase.from('process_movement_type_prefs').upsert({
      process_id: processId,
      space_id: this.spaceId(),
      name,
      notify_responsible: responsible,
      notify_client: client,
      updated_by: this.auth.userId(),
    });
    if (error) throw error;
  }

  /** Volta o processo inteiro ao padrão do escritório. */
  async resetProcess(processId: string): Promise<void> {
    const { error } = await this.supabase
      .from('process_movement_type_prefs')
      .delete()
      .eq('process_id', processId);
    if (error) throw error;
  }
}
