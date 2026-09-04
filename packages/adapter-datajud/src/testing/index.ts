/**
 * Utilitários de teste do `@juriflow/adapter-datajud`.
 *
 * Todas as fixtures são ANONIMIZADAS e SINTÉTICAS:
 *   - números de processo fictícios (não correspondem a processos reais);
 *   - nenhuma credencial, chave de API ou segredo em qualquer forma.
 */
import type { FetchLike } from '../datajud-adapter.js';

/** Constrói uma resposta compatível com o subconjunto de `fetch` que o adapter usa. */
export function fakeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Awaited<ReturnType<FetchLike>> {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string): string | null => lower.get(name.toLowerCase()) ?? null },
    json: async (): Promise<unknown> => body,
  };
}

/** Resposta HTTP 200 cujo corpo NÃO é JSON válido (rejeita em `.json()`). */
export function fakeInvalidJsonResponse(): Awaited<ReturnType<FetchLike>> {
  return {
    ok: true,
    status: 200,
    headers: { get: (): string | null => null },
    json: async (): Promise<unknown> => {
      throw new SyntaxError('Unexpected token < in JSON at position 0');
    },
  };
}

/** `fetchFn` que registra as chamadas e devolve `response` (ou lança `throws`). */
export function recordingFetch(
  response: Awaited<ReturnType<FetchLike>> | (() => Promise<Awaited<ReturnType<FetchLike>>>),
  opts: { throws?: unknown } = {},
): { fetchFn: FetchLike; calls: { url: string; init: Parameters<FetchLike>[1] }[] } {
  const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (opts.throws) throw opts.throws;
    return typeof response === 'function' ? response() : response;
  };
  return { fetchFn, calls };
}

// ---------------------------------------------------------------------------
// Fixtures de envelope Elasticsearch (`hits.hits[0]._source`)
// ---------------------------------------------------------------------------

function esEnvelope(source: unknown | null): unknown {
  if (source == null) {
    return { took: 3, hits: { total: { value: 0, relation: 'eq' }, hits: [] } };
  }
  return {
    took: 7,
    timed_out: false,
    hits: {
      total: { value: 1, relation: 'eq' },
      max_score: 1,
      hits: [{ _index: 'fixture', _id: 'FIXTURE', _score: 1, _source: source }],
    },
  };
}

const CNJ_FICTICIO = '00008325020238040001';

/** 1) Envelope válido com movimentos "normais" (inclui um código fora da taxonomia curada). */
export const envelopeWithMovements = esEnvelope({
  numeroProcesso: CNJ_FICTICIO,
  tribunal: 'TJXX',
  grau: 'G1',
  classe: { codigo: 436, nome: 'Procedimento Comum Cível' },
  orgaoJulgador: { codigo: 1, nome: '1a Vara Cível Fictícia' },
  dataAjuizamento: '2023-02-10T11:00:00.000Z',
  dataHoraUltimaAtualizacao: '2024-03-01T18:22:00.000Z',
  nivelSigilo: 0,
  movimentos: [
    { codigo: 26, nome: 'Distribuição', dataHora: '2023-02-10T11:05:00.000Z' },
    { codigo: 132, nome: 'Juntada', dataHora: '2023-03-01T09:00:00.000Z' },
    { codigo: 848, nome: 'Sentença', dataHora: '2024-02-20T14:30:00.000Z' },
    // código propositalmente fora da taxonomia curada:
    {
      codigo: 999999,
      nome: 'Movimento Fictício Não Catalogado',
      dataHora: '2024-02-25T10:00:00.000Z',
    },
  ],
});

/** 2) Movimento com `complementosTabelados`. */
export const envelopeWithComplementos = esEnvelope({
  numeroProcesso: CNJ_FICTICIO,
  tribunal: 'TJXX',
  grau: 'G1',
  dataHoraUltimaAtualizacao: '2024-04-02T12:00:00.000Z',
  movimentos: [
    {
      codigo: 193,
      nome: 'Decisão',
      dataHora: '2024-04-01T16:00:00.000Z',
      complementosTabelados: [
        { codigo: 7, nome: 'tipo_de_decisao', descricao: 'Concessão' },
        { codigo: 3, nome: 'natureza', descricao: 'Liminar' },
      ],
    },
  ],
});

/** 3) Movimento sem `dataHora`. */
export const envelopeMissingDataHora = esEnvelope({
  numeroProcesso: CNJ_FICTICIO,
  tribunal: 'TJXX',
  movimentos: [
    { codigo: 60, nome: 'Expedição de documento', dataHora: '2024-01-05T08:00:00.000Z' },
    { codigo: 11009, nome: 'Mero expediente' },
  ],
});

/** 5) HTTP 200 com zero hits (processo ausente no DataJud). */
export const envelopeZeroHits = esEnvelope(null);

/** 10) Envelope estruturalmente inválido (sem `hits`). */
export const envelopeInvalidShape = { erro: 'requisição malformada', status: 400 };

/** 11) Envelope com mais movimentos que o limite — para exercitar `partial`. */
export function envelopeHuge(count: number): unknown {
  const movimentos = Array.from({ length: count }, (_, i) => ({
    codigo: 132,
    nome: 'Juntada',
    dataHora: `2024-${String((i % 12) + 1).padStart(2, '0')}-15T09:00:00.000Z`,
  }));
  return esEnvelope({
    numeroProcesso: CNJ_FICTICIO,
    tribunal: 'TJXX',
    movimentos,
  });
}

export const FIXTURE_CNJ = CNJ_FICTICIO;
