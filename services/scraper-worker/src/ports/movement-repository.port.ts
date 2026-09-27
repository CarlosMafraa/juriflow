import type { RawMovement } from '@juriflow/collectors-core';
import type { MovementMode } from './process-repository.port.js';

/** Movimentação já persistida, com o id gerado pelo banco. */
export interface StoredMovement {
  readonly id: string;
  readonly contentHash: string;
  readonly description: string;
  readonly occurredAt: string | null;
  /** Tipo normalizado (título sem nome de parte); null se a fonte não separa. */
  readonly movementType: string | null;
}

/** Movimentação pronta para gravar: hash de deduplicação e tipo já calculados. */
export type MovementToInsert = RawMovement & {
  readonly contentHash: string;
  readonly movementType: string | null;
};

/** Porta de leitura/escrita de `process_movements`. */
export interface MovementRepository {
  /** Hashes já conhecidos para este processo — usado para deduplicar antes de inserir (RN16). */
  listKnownHashes(processId: string): Promise<ReadonlySet<string>>;

  /**
   * Movimentações vigentes do processo na fonte pedida (tribunal ou manuais),
   * da mais antiga para a mais nova. Manual excluída não entra.
   */
  listByProcess(processId: string, mode: MovementMode): Promise<StoredMovement[]>;

  /**
   * Insere só as movimentações cujo hash ainda não existe para o processo.
   * Retorna as que de fato foram inseridas (as novas), na ordem recebida.
   */
  insertNewMovements(
    processId: string,
    spaceId: string,
    movements: readonly MovementToInsert[],
  ): Promise<StoredMovement[]>;
}
