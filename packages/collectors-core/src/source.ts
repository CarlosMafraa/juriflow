/**
 * Contrato de uma fonte de acompanhamento processual (a "porta").
 *
 * FASE 2: apenas o contrato. Adapters concretos (DataJud, TribunalApi,
 * Projudi/TJAM, Scraper) chegam na Fase de Acompanhamento. Ver ADR-0004.
 */

/**
 * Estratégias conhecidas. É um union aberto de propósito: novas fontes podem
 * ser registradas com qualquer identificador sem alterar este arquivo.
 */
export type KnownSourceKind = 'datajud' | 'tribunal_api' | 'projudi_tjam' | 'scraper';

export type SourceKind = KnownSourceKind | (string & {});

/** Referência ao processo a coletar (sem acoplar ao modelo de dados). */
export interface SourceTarget {
  /** Número CNJ normalizado, quando houver. */
  readonly cnjNumber: string | null;
  /** Identificador do tribunal no catálogo do JuriFlow. */
  readonly courtId: string;
  /** Parâmetros específicos da fonte (ex.: id interno no tribunal). */
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface SourceFetchInput {
  readonly target: SourceTarget;
  /** Coleta incremental: só o que mudou desde este instante, quando suportado. */
  readonly since?: Date;
  /** Correlação para logs/auditoria. */
  readonly requestId?: string;
}

/**
 * Movimentação como veio da fonte, ainda NÃO normalizada.
 * `raw` preserva o payload original para auditoria e re-normalização.
 */
export interface RawMovement {
  readonly sourceKind: SourceKind;
  /** Id da movimentação na fonte, quando estável. */
  readonly sourceMovementId: string | null;
  /** Data da movimentação informada pela fonte. */
  readonly occurredAt: string | null;
  readonly description: string;
  readonly raw: unknown;
}

export interface SourceFetchResult {
  readonly sourceKind: SourceKind;
  readonly collectedAt: string;
  readonly movements: readonly RawMovement[];
}

export interface ProcessDataSource {
  readonly kind: SourceKind;
  /** Indica se esta fonte sabe coletar o alvo informado. */
  canHandle(target: SourceTarget): boolean;
  fetch(input: SourceFetchInput): Promise<SourceFetchResult>;
}

/** Fábrica de fonte — permite injeção de dependências/config por instância. */
export type ProcessDataSourceFactory = () => ProcessDataSource;
