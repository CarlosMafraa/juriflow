/**
 * Saúde do worker (regra P10): batimento periódico e resultado da última
 * consulta ao tribunal. Só dado de infraestrutura — nada de escritório.
 */
export interface WorkerStatusReporter {
  heartbeat(): Promise<void>;
  sourceSucceeded(): Promise<void>;
  sourceFailed(error: string): Promise<void>;
}
