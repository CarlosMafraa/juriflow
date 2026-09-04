/**
 * Validação e extração do envelope Elasticsearch devolvido pela API Pública
 * do DataJud (`POST /{alias}/_search`).
 *
 * A API responde no formato ES: `{ hits: { total: { value }, hits: [ { _source } ] } }`.
 * Envelope malformado ⇒ `CollectionParseError` (não retriável).
 * HTTP 200 com zero hits ⇒ NÃO é erro: devolvemos `{ totalHits: 0, source: null }`
 * e o adapter trata como "processo não encontrado no DataJud" (DJ-8).
 */
import { CollectionParseError } from '@juriflow/collector-engine';
import type { DataJudComplemento } from './describe.js';

export interface DataJudMovimento {
  readonly codigo?: number | string | null;
  readonly nome?: string | null;
  readonly dataHora?: string | null;
  readonly complementosTabelados?: DataJudComplemento[] | null;
}

/** Subconjunto de `_source` que consumimos. O objeto inteiro vai para `raw`. */
export interface DataJudSource {
  readonly numeroProcesso?: string | null;
  readonly tribunal?: string | null;
  readonly grau?: string | null;
  readonly classe?: { codigo?: number | string | null; nome?: string | null } | null;
  readonly orgaoJulgador?: { codigo?: number | string | null; nome?: string | null } | null;
  readonly dataAjuizamento?: string | null;
  readonly dataHoraUltimaAtualizacao?: string | null;
  readonly nivelSigilo?: number | null;
  readonly movimentos?: DataJudMovimento[] | null;
  readonly [key: string]: unknown;
}

export interface ParsedEnvelope {
  readonly totalHits: number;
  /** `null` quando não há hits (processo ausente no DataJud). */
  readonly source: DataJudSource | null;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CollectionParseError(`Resposta do DataJud inválida: ${label} não é um objeto.`);
  }
  return value as Record<string, unknown>;
}

/** Interpreta o corpo já desserializado. Lança `CollectionParseError` se malformado. */
export function parseElasticEnvelope(body: unknown): ParsedEnvelope {
  const root = asRecord(body, 'corpo');
  const hits = asRecord(root['hits'], '"hits"');

  const total = hits['total'];
  let totalHits: number;
  if (typeof total === 'number') {
    totalHits = total;
  } else if (total && typeof total === 'object') {
    const value = (total as Record<string, unknown>)['value'];
    totalHits = typeof value === 'number' ? value : Number.NaN;
  } else {
    totalHits = Number.NaN;
  }
  if (!Number.isFinite(totalHits)) {
    throw new CollectionParseError('Resposta do DataJud inválida: "hits.total.value" ausente.');
  }

  const inner = hits['hits'];
  if (!Array.isArray(inner)) {
    throw new CollectionParseError('Resposta do DataJud inválida: "hits.hits" não é uma lista.');
  }

  if (inner.length === 0) {
    return { totalHits: 0, source: null };
  }

  const first = asRecord(inner[0], '"hits.hits[0]"');
  const source = first['_source'];
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new CollectionParseError('Resposta do DataJud inválida: "_source" ausente no hit.');
  }

  return { totalHits, source: source as DataJudSource };
}
