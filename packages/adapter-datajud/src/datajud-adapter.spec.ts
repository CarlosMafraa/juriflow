import {
  CollectionAuthError,
  CollectionParseError,
  CollectionRateLimitedError,
  CollectionTimeoutError,
  CollectionUnavailableError,
} from '@juriflow/collector-engine';
import type { SourceFetchInput } from '@juriflow/collectors-core';
import { describe, expect, it, vi } from 'vitest';
import { DataJudAdapter, type DataJudStrategy } from './datajud-adapter.js';
import {
  FIXTURE_CNJ,
  envelopeHuge,
  envelopeInvalidShape,
  envelopeMissingDataHora,
  envelopeWithComplementos,
  envelopeWithMovements,
  envelopeZeroHits,
  fakeInvalidJsonResponse,
  fakeResponse,
  recordingFetch,
} from './testing/index.js';

const API_KEY = 'test-secret-key-NEVER-REAL';
const STRATEGY: DataJudStrategy = { alias: 'api_publica_tjxx', timeoutMs: 5000, maxMovements: 10 };

function makeInput(overrides: Partial<SourceFetchInput> = {}): SourceFetchInput {
  return {
    target: { cnjNumber: '0000832-50.2023.8.04.0001', courtId: 'court-1', params: {} },
    requestId: 'run-1',
    ...overrides,
  };
}

function makeAdapter(
  fetchFn: ReturnType<typeof recordingFetch>['fetchFn'],
  opts: { strategy?: DataJudStrategy; logger?: Parameters<typeof vi.fn>[0] } = {},
): DataJudAdapter {
  return new DataJudAdapter({
    apiKey: API_KEY,
    resolveStrategy: () => opts.strategy ?? STRATEGY,
    endpointBase: 'https://datajud.example.test',
    fetchFn,
    now: () => new Date('2024-05-01T00:00:00.000Z'),
    logger: opts.logger as never,
  });
}

describe('DataJudAdapter.fetch — sucesso', () => {
  it('monta a requisição no endpoint público com match por numeroProcesso sem máscara e size 1', async () => {
    const { fetchFn, calls } = recordingFetch(fakeResponse(200, envelopeWithMovements));
    const adapter = makeAdapter(fetchFn);

    await adapter.fetch(makeInput());

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://datajud.example.test/api_publica_tjxx/_search');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      query: { match: { numeroProcesso: '00008325020238040001' } },
      size: 1,
    });
    expect(calls[0].init?.headers?.Authorization).toBe(`APIKey ${API_KEY}`);
  });

  it('converte movimentos em RawMovement: sourceMovementId null, occurredAt = dataHora, dica de código em raw', async () => {
    const { fetchFn } = recordingFetch(fakeResponse(200, envelopeWithMovements));
    const result = await makeAdapter(fetchFn).fetch(makeInput());

    expect(result.sourceKind).toBe('datajud');
    expect(result.partial).toBeUndefined();
    expect(result.movements).toHaveLength(4);

    const distribuicao = result.movements[0];
    expect(distribuicao.sourceMovementId).toBeNull();
    expect(distribuicao.occurredAt).toBe('2023-02-10T11:05:00.000Z');
    expect(distribuicao.description).toBe('Distribuição');
    expect((distribuicao.raw as Record<string, unknown>).movementCode).toBe('26');
    expect((distribuicao.raw as Record<string, unknown>).movementLabel).toBe('Distribuição');
  });

  it('inclui complementos tabelados na descrição de forma determinística', async () => {
    const { fetchFn } = recordingFetch(fakeResponse(200, envelopeWithComplementos));
    const result = await makeAdapter(fetchFn).fetch(makeInput());
    expect(result.movements[0].description).toBe(
      'Decisão — natureza: Liminar; tipo_de_decisao: Concessão',
    );
  });

  it('mantém occurredAt null quando o movimento não tem dataHora', async () => {
    const { fetchFn } = recordingFetch(fakeResponse(200, envelopeMissingDataHora));
    const result = await makeAdapter(fetchFn).fetch(makeInput());
    expect(result.movements[1].occurredAt).toBeNull();
    expect(result.movements[1].description).toBe('Mero expediente');
  });

  it('trunca e marca partial quando há mais movimentos que max_movements', async () => {
    const { fetchFn } = recordingFetch(fakeResponse(200, envelopeHuge(25)));
    const adapter = makeAdapter(fetchFn, { strategy: { alias: 'a', maxMovements: 5 } });
    const result = await adapter.fetch(makeInput());
    expect(result.movements).toHaveLength(5);
    expect(result.partial).toBe(true);
  });
});

describe('DataJudAdapter.fetch — processo ausente (DJ-8)', () => {
  it('HTTP 200 com zero hits devolve resultado vazio, sem lançar', async () => {
    const { fetchFn } = recordingFetch(fakeResponse(200, envelopeZeroHits));
    const result = await makeAdapter(fetchFn).fetch(makeInput());
    expect(result.movements).toEqual([]);
    expect(result.partial).toBeUndefined();
  });

  it('alvo sem número CNJ de 20 dígitos devolve resultado vazio, sem chamar o DataJud', async () => {
    const { fetchFn, calls } = recordingFetch(fakeResponse(200, envelopeWithMovements));
    const result = await makeAdapter(fetchFn).fetch(
      makeInput({ target: { cnjNumber: null, courtId: 'c', params: {} } }),
    );
    expect(result.movements).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('DataJudAdapter.fetch — classificação de falhas', () => {
  it('429 → CollectionRateLimitedError e loga o Retry-After (sem alterar o fluxo)', async () => {
    const logger = vi.fn();
    const { fetchFn } = recordingFetch(fakeResponse(429, {}, { 'Retry-After': '30' }));
    const adapter = makeAdapter(fetchFn, { logger });
    await expect(adapter.fetch(makeInput())).rejects.toBeInstanceOf(CollectionRateLimitedError);
    expect(logger).toHaveBeenCalledWith('warn', expect.stringContaining('429'), expect.any(Object));
  });

  it('5xx → CollectionUnavailableError', async () => {
    const { fetchFn } = recordingFetch(fakeResponse(503, {}));
    await expect(makeAdapter(fetchFn).fetch(makeInput())).rejects.toBeInstanceOf(
      CollectionUnavailableError,
    );
  });

  it('401 → CollectionAuthError (não retriável)', async () => {
    const { fetchFn } = recordingFetch(fakeResponse(401, {}));
    const err = await makeAdapter(fetchFn)
      .fetch(makeInput())
      .catch((e) => e);
    expect(err).toBeInstanceOf(CollectionAuthError);
    expect(err.retriable).toBe(false);
  });

  it('corpo não-JSON → CollectionParseError', async () => {
    const { fetchFn } = recordingFetch(fakeInvalidJsonResponse());
    await expect(makeAdapter(fetchFn).fetch(makeInput())).rejects.toBeInstanceOf(
      CollectionParseError,
    );
  });

  it('envelope estruturalmente inválido → CollectionParseError', async () => {
    const { fetchFn } = recordingFetch(fakeResponse(200, envelopeInvalidShape));
    await expect(makeAdapter(fetchFn).fetch(makeInput())).rejects.toBeInstanceOf(
      CollectionParseError,
    );
  });

  it('abort do AbortController → CollectionTimeoutError', async () => {
    const { fetchFn } = recordingFetch(fakeResponse(200, {}), {
      throws: Object.assign(new Error('aborted'), { name: 'AbortError' }),
    });
    await expect(makeAdapter(fetchFn).fetch(makeInput())).rejects.toBeInstanceOf(
      CollectionTimeoutError,
    );
  });

  it('erro de rede genérico → CollectionUnavailableError', async () => {
    const { fetchFn } = recordingFetch(fakeResponse(200, {}), {
      throws: new TypeError('fetch failed'),
    });
    await expect(makeAdapter(fetchFn).fetch(makeInput())).rejects.toBeInstanceOf(
      CollectionUnavailableError,
    );
  });

  it('abort durante a leitura do corpo (timeout global) → CollectionTimeoutError', async () => {
    // headers chegam (200), mas o corpo nunca completa e o AbortController dispara.
    const bodyTimeout = {
      ok: true,
      status: 200,
      headers: { get: (): string | null => null },
      json: async (): Promise<unknown> => {
        throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
      },
    };
    const { fetchFn } = recordingFetch(bodyTimeout as never);
    await expect(makeAdapter(fetchFn).fetch(makeInput())).rejects.toBeInstanceOf(
      CollectionTimeoutError,
    );
  });
});

describe('DataJudAdapter — segurança da credencial', () => {
  it('nunca passa a apiKey para o logger', async () => {
    const logger = vi.fn();
    const { fetchFn } = recordingFetch(fakeResponse(429, {}, { 'Retry-After': '5' }));
    await makeAdapter(fetchFn, { logger })
      .fetch(makeInput())
      .catch(() => undefined);
    for (const call of logger.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(API_KEY);
    }
  });

  it('nunca inclui a apiKey nas mensagens de erro', async () => {
    const { fetchFn } = recordingFetch(fakeResponse(401, {}));
    const err = await makeAdapter(fetchFn)
      .fetch(makeInput())
      .catch((e) => e);
    expect(err.message).not.toContain(API_KEY);
  });

  it('rejeita construção sem apiKey', () => {
    expect(() => new DataJudAdapter({ apiKey: '', resolveStrategy: () => STRATEGY })).toThrow(
      /apiKey ausente/,
    );
  });
});

describe('DataJudAdapter.canHandle', () => {
  it('exige número CNJ com 20 dígitos', () => {
    const adapter = new DataJudAdapter({ apiKey: API_KEY, resolveStrategy: () => STRATEGY });
    expect(adapter.canHandle({ cnjNumber: `${FIXTURE_CNJ}`, courtId: 'c' })).toBe(true);
    expect(adapter.canHandle({ cnjNumber: '123', courtId: 'c' })).toBe(false);
    expect(adapter.canHandle({ cnjNumber: null, courtId: 'c' })).toBe(false);
  });
});
