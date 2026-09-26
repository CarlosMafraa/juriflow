import type { MovementTypeAudiences } from '../domain/movement-type.js';

/**
 * Filtro de notificação por tipo de movimentação (`space_movement_types` +
 * `process_movement_type_prefs`).
 */
export interface MovementTypePolicy {
  /** Inclui na lista do escritório os tipos que ainda não existem (toggles ligados). */
  registerTypes(spaceId: string, types: readonly string[]): Promise<void>;

  /** Função que diz, para cada tipo, se avisa responsáveis e/ou clientes neste processo. */
  resolve(
    processId: string,
    spaceId: string,
  ): Promise<(movementType: string | null) => MovementTypeAudiences>;
}
