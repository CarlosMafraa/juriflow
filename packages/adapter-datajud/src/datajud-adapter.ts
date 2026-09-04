/**
 * `DataJudAdapter` — fonte de acompanhamento processual sobre a API Pública
 * do DataJud (CNJ).
 *
 * Responsabilidade EXCLUSIVA: comunicação HTTP com o DataJud e transformação
 * do payload específico do DataJud em `RawMovement`. Não conhece banco, RLS,
 * scheduler nem o modelo de dados do JuriFlow. Não é importado pelo núcleo de
 * domínio nem pelo normalizador (regra 18).
 *
 * Contrato implementado: `ProcessDataSource` (`@juriflow/collectors-core`).
 *
 * A URL base é constante interna (NÃO vem de `source_params`). A credencial é
 * injetada no construtor e nunca aparece hardcoded, em log, em erro ou em fixture.
 */
import {
  CollectionParseError,
  CollectionTimeoutError,
  CollectionUnavailableError,
} from '@juriflow/collector-engine';
import type {
  ProcessDataSource,
  SourceFetchInput,
  SourceFetchResult,
  SourceKind,
  SourceTarget,
} from '@juriflow/collectors-core';
import { parseElasticEnvelope } from './envelope.js';
import { classifyHttpFailure } from './http.js';
import { buildProcessContext, mapMovimento } from './map.js';

/** Base pública oficial da API do DataJud. Constante interna — nunca de params. */
export const DATAJUD_ENDPOINT_BASE = 'https://api-publica.datajud.cnj.jus.br';

/** Padrões quando a estratégia do tribunal não informa. */
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_MOVEMENTS = 5_000;

/** Config resolvida por tribunal (vem de `court_tracking_strategies.params`). */
export interface DataJudStrategy {
  /** Alias do índice no DataJud, ex.: `api_publica_tjam`. */
  readonly alias: string;
  readonly timeoutMs?: number;
  readonly maxMovements?: number;
}

/** Resolve a estratégia do tribunal. Injetado — o adapter não lê o banco. */
export type DataJudStrategyResolver = (
  courtId: string,
) => DataJudStrategy | Promise<DataJudStrategy>;

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export type AdapterLogger = (
  level: 'info' | 'warn',
  message: string,
  context?: Record<string, unknown>,
) => void;

export interface DataJudAdapterOptions {
  /** Credencial `APIKey` da API Pública. Injetada; nunca hardcoded. */
  readonly apiKey: string;
  readonly resolveStrategy: DataJudStrategyResolver;
  /** Sobrescreve a base pública (testes). Default: `DATAJUD_ENDPOINT_BASE`. */
  readonly endpointBase?: string;
  /** `fetch` injetável. Default: `globalThis.fetch`. */
  readonly fetchFn?: FetchLike;
  /** Identificador da fonte. Default: `'datajud'`. */
  readonly kind?: SourceKind;
  /** Relógio injetável (testes determinísticos). */
  readonly now?: () => Date;
  /** Log estruturado — jamais recebe a credencial. */
  readonly logger?: AdapterLogger;
}

function onlyDigits(value: string): string {
  return value.replace(/\D+/g, '');
}

export class DataJudAdapter implements ProcessDataSource {
  readonly kind: SourceKind;

  private readonly apiKey: string;
  private readonly resolveStrategy: DataJudStrategyResolver;
  private readonly endpointBase: string;
  private readonly fetchFn: FetchLike;
  private readonly now: () => Date;
  private readonly logger: AdapterLogger | undefined;

  constructor(options: DataJudAdapterOptions) {
    if (!options.apiKey || options.apiKey.trim().length === 0) {
      throw new Error('DataJudAdapter: apiKey ausente.');
    }
    this.apiKey = options.apiKey;
    this.resolveStrategy = options.resolveStrategy;
    this.endpointBase = (options.endpointBase ?? DATAJUD_ENDPOINT_BASE).replace(/\/+$/, '');
    const injectedFetch = options.fetchFn ?? (globalThis.fetch as unknown as FetchLike | undefined);
    if (!injectedFetch) {
      throw new Error('DataJudAdapter: fetch indisponível — injete `fetchFn`.');
    }
    this.fetchFn = injectedFetch;
    this.kind = options.kind ?? 'datajud';
    this.now = options.now ?? ((): Date => new Date());
    this.logger = options.logger;
  }

  /** O DataJud precisa do número CNJ; a elegibilidade real é da estratégia do tribunal. */
  canHandle(target: SourceTarget): boolean {
    return typeof target.cnjNumber === 'string' && onlyDigits(target.cnjNumber).length === 20;
  }

  async fetch(input: SourceFetchInput): Promise<SourceFetchResult> {
    const { target } = input;
    const collectedAt = this.now().toISOString();

    // Sem CNJ não há o que consultar. DJ-8: resultado vazio, não é falha.
    if (!target.cnjNumber || onlyDigits(target.cnjNumber).length !== 20) {
      this.logger?.('warn', 'DataJud: alvo sem número CNJ de 20 dígitos — resultado vazio.', {
        courtId: target.courtId,
        requestId: input.requestId,
      });
      return { sourceKind: this.kind, collectedAt, movements: [] };
    }

    const strategy = await this.resolveStrategy(target.courtId);
    const timeoutMs = strategy.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxMovements = strategy.maxMovements ?? DEFAULT_MAX_MOVEMENTS;
    const url = `${this.endpointBase}/${strategy.alias}/_search`;
    const body = JSON.stringify({
      query: { match: { numeroProcesso: onlyDigits(target.cnjNumber) } },
      size: 1,
    });

    // Timeout GLOBAL da operação: cobre conexão + headers + leitura do corpo +
    // parse. O timer só é limpo depois do `response.json()`.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Awaited<ReturnType<FetchLike>>;
      try {
        response = await this.fetchFn(url, {
          method: 'POST',
          headers: {
            Authorization: `APIKey ${this.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body,
          signal: controller.signal,
        });
      } catch (err) {
        if ((err as { name?: string } | null)?.name === 'AbortError') {
          throw new CollectionTimeoutError(`DataJud não respondeu em ${timeoutMs}ms.`);
        }
        throw new CollectionUnavailableError(
          `Falha de rede ao consultar o DataJud: ${(err as Error)?.message ?? 'desconhecida'}.`,
        );
      }

      if (!response.ok) {
        const retryAfter = response.headers.get('retry-after');
        const error = classifyHttpFailure({ status: response.status, retryAfter });
        if (error.code === 'rate_limited') {
          this.logger?.('warn', 'DataJud: HTTP 429 (limite de requisições).', {
            retryAfter: retryAfter ?? null,
            requestId: input.requestId,
          });
        }
        throw error;
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (err) {
        if ((err as { name?: string } | null)?.name === 'AbortError') {
          throw new CollectionTimeoutError(
            `DataJud não completou o envio do corpo em ${timeoutMs}ms.`,
          );
        }
        throw new CollectionParseError('Corpo da resposta do DataJud não é JSON válido.');
      }

      const envelope = parseElasticEnvelope(payload);
      if (envelope.totalHits === 0 || envelope.source == null) {
        // DJ-8: processo não encontrado no DataJud ⇒ resultado vazio (não é falha,
        // não incrementa consecutive_failures, não dispara auto-pausa).
        this.logger?.('info', 'DataJud: processo não encontrado no índice.', {
          courtId: target.courtId,
          requestId: input.requestId,
        });
        return { sourceKind: this.kind, collectedAt, movements: [] };
      }

      const processContext = buildProcessContext(envelope.source);
      const rawMovimentos = Array.isArray(envelope.source.movimentos)
        ? [...envelope.source.movimentos]
        : [];

      let partial = false;
      let selected = rawMovimentos;
      if (rawMovimentos.length > maxMovements) {
        selected = [...rawMovimentos]
          .sort((a, b) => String(b.dataHora ?? '').localeCompare(String(a.dataHora ?? '')))
          .slice(0, maxMovements);
        partial = true;
        this.logger?.('warn', 'DataJud: movimentos truncados pelo limite da estratégia.', {
          total: rawMovimentos.length,
          max: maxMovements,
          requestId: input.requestId,
        });
      }

      const movements = selected.map((m) => mapMovimento(m, this.kind, processContext));
      const result: SourceFetchResult = { sourceKind: this.kind, collectedAt, movements };
      return partial ? { ...result, partial: true } : result;
    } finally {
      clearTimeout(timer);
    }
  }
}
