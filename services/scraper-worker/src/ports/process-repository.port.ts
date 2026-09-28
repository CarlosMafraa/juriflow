import type { SourceKind } from '@juriflow/collectors-core';

/**
 * Fonte das movimentações que o processo mostra e avisa — uma por vez, nunca
 * as duas (0048): sincronização ligada = tribunal; desligada = manuais.
 */
export type MovementMode = 'automatic' | 'manual';

/** Processo que pode receber avisos (qualquer processo ativo). */
export interface NotifiableProcess {
  readonly id: string;
  readonly spaceId: string;
  /** Número CNJ, ou a referência interna em processo manual sem CNJ. */
  readonly reference: string;
  readonly mode: MovementMode;
}

/** Processo elegível para coleta automática — só os campos que o pipeline precisa. */
export interface TrackableProcess {
  readonly id: string;
  readonly spaceId: string;
  readonly cnjNumber: string;
  readonly courtId: string;
  readonly sourceKind: SourceKind;
  readonly lastStateHash: string | null;
  /** Tinha movimentações manuais: a próxima coleta só registra, sem avisar (N13). */
  readonly syncBaselinePending?: boolean;
}

export function asNotifiable(process: TrackableProcess): NotifiableProcess {
  return {
    id: process.id,
    spaceId: process.spaceId,
    reference: process.cnjNumber,
    mode: 'automatic',
  };
}

export interface TrackingStateUpdate {
  readonly lastStateHash: string;
  readonly lastCheckedAt: Date;
  readonly lastCheckError: string | null;
}

/**
 * Porta para leitura/escrita do estado de acompanhamento em `processes`.
 * O pipeline não sabe que isso é Postgres/Supabase (Dependency Inversion).
 */
export interface ProcessRepository {
  /** Todos os processos ativos, com tracking habilitado e CNJ presente (RN: sem CNJ ⇒ sem acompanhamento). */
  listTrackableProcesses(): Promise<TrackableProcess[]>;
  findTrackableProcessById(processId: string): Promise<TrackableProcess | null>;
  /** Processo ativo de espaço ativo, com o modo (fonte) valendo agora; null se não. */
  findNotifiableProcessById(processId: string): Promise<NotifiableProcess | null>;
  /** A leva da 1ª sincronização já foi registrada sem aviso. */
  clearSyncBaseline(processId: string): Promise<void>;
  updateTrackingState(processId: string, update: TrackingStateUpdate): Promise<void>;
  /** Pedidos de "consultar agora" pendentes (RN seção 39), mais antigos primeiro. */
  listCheckRequestedIds(limit: number): Promise<string[]>;
  /** Tira o processo da fila de consulta manual — com ou sem sucesso na coleta. */
  clearCheckRequest(processId: string): Promise<void>;
}
