import type { SourceKind } from '@juriflow/collectors-core';

/** Processo elegível para coleta automática — só os campos que o pipeline precisa. */
export interface TrackableProcess {
  readonly id: string;
  readonly spaceId: string;
  readonly cnjNumber: string;
  readonly courtId: string;
  readonly sourceKind: SourceKind;
  readonly lastStateHash: string | null;
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
  updateTrackingState(processId: string, update: TrackingStateUpdate): Promise<void>;
}
