/**
 * JuriFlow — extrai vetores de contrato (entrada/saída neutros de linguagem)
 * a partir do comportamento REAL do `@juriflow/movement-normalizer` e do
 * `@juriflow/collector-engine` (TypeScript), para uso futuro por uma suíte
 * de testes Go equivalente (Acompanhamento-F, decisão F-1/F-2).
 *
 * NÃO é um teste — é uma ferramenta de geração. Os valores (`content_hash`,
 * `state_hash`, mensagens de erro) são calculados executando o código real,
 * nunca transcritos à mão, para eliminar risco de erro de transcrição.
 *
 * Reexecutar sempre que `normalizeMovement`/`detectChanges`/`classifyError`
 * mudarem de comportamento (política de equivalência TS↔Go da Acompanhamento-F):
 *
 *   tsc -b packages/collectors-core packages/movement-normalizer packages/collector-engine
 *   node scripts/extract-contract-vectors.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { normalizeMovement, detectChanges } from '@juriflow/movement-normalizer';
import {
  classifyError,
  runCollection,
  CollectionTimeoutError,
  CollectionUnavailableError,
  CollectionRateLimitedError,
  CollectionAuthError,
  CollectionParseError,
  CollectionNotFoundError,
} from '@juriflow/collector-engine';
import { rawMovement } from '@juriflow/collector-engine/testing';
import { SourceNotRegisteredError, SourceUnavailableError } from '@juriflow/collectors-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'contracts', 'collector-engine');

// ---------------------------------------------------------------------------
// normalize-movement.json — espelha packages/movement-normalizer/src/normalize.spec.ts
// ---------------------------------------------------------------------------

/** Resolvedor de categoria do próprio arquivo de teste TS (não é lógica de produção
 * — a resolução real vem de `movement_categories`; aqui só fixamos, por vetor, o
 * que o resolvedor decide, para que o teste Go não precise replicar um regex). */
const testResolveCategory = (h) => {
  if (h.code === '26' || /distribu/i.test(h.label ?? '')) {
    return { code: '26', label: 'Distribuição' };
  }
  return null;
};

function raw(o) {
  return {
    sourceKind: 'datajud',
    sourceMovementId: o.sourceMovementId ?? null,
    occurredAt: o.occurredAt ?? null,
    description: o.description,
    raw: o.raw ?? { description: o.description },
  };
}

const normalizeCtx = { sourceKind: 'datajud', resolveCategory: testResolveCategory };

function toVector(name, rawMovement) {
  const out = normalizeMovement(rawMovement, normalizeCtx);
  return {
    name,
    raw: rawMovement,
    sourceKind: 'datajud',
    expected: {
      sourceKind: out.sourceKind,
      sourceMovementId: out.sourceMovementId,
      occurredAt: out.occurredAt,
      categoryCode: out.categoryCode,
      categoryLabel: out.categoryLabel,
      description: out.description,
      contentHash: out.contentHash,
      needsReview: out.needsReview,
    },
  };
}

const rawA = raw({ description: '  Processo   DISTRIBUÍDO  ', occurredAt: '2024-03-10T13:00:00Z' });
const rawB = raw({ description: 'Processo distribuído', occurredAt: '2024-03-10T20:00:00Z' });
const vecA = toVector('mesmo dia + mesma categoria + descrição equivalente ⇒ mesmo content_hash (a)', rawA);
const vecB = toVector('mesmo dia + mesma categoria + descrição equivalente ⇒ mesmo content_hash (b)', rawB);

const rawSemData = raw({ description: 'Processo distribuído' });
const rawCategoriaDesconhecida = raw({ description: 'Ato incomum', occurredAt: '2024-01-01T00:00:00Z' });
const rawComHint = raw({
  description: 'texto livre',
  occurredAt: '2024-01-01T00:00:00Z',
  raw: { movementCode: '26', movementLabel: 'Distribuição' },
});
const rawM1 = raw({ description: 'Juntada', occurredAt: '2024-01-01T00:00:00Z', sourceMovementId: 'x1' });
const rawM2 = raw({ description: 'Juntada', occurredAt: '2024-01-02T00:00:00Z', sourceMovementId: 'x1' });
const rawM3 = raw({ description: 'Juntada', occurredAt: '2024-01-01T00:00:00Z', sourceMovementId: 'x2' });

const normalizeMovementVectors = [
  vecA,
  vecB,
  toVector('needsReview=true quando falta occurredAt', rawSemData),
  toVector('needsReview=true quando a categoria não é reconhecida', rawCategoriaDesconhecida),
  toVector('usa movementCode/movementLabel do raw quando presentes', rawComHint),
  toVector('data diferente ⇒ content_hash diferente (m1)', rawM1),
  toVector('data diferente ⇒ content_hash diferente (m2)', rawM2),
  toVector('sourceMovementId diferente ⇒ content_hash diferente (m3)', rawM3),
];

// Invariantes cruzados entre vetores (o que os testes TS originais comparavam
// entre si, além de cada valor absoluto individual):
const normalizeMovementInvariants = [
  {
    name: 'a.contentHash === b.contentHash (mesmo dia, mesma categoria, descrição equivalente)',
    equalContentHashOf: [vecA.name, vecB.name],
  },
];

// ---------------------------------------------------------------------------
// detect-changes.json — espelha packages/movement-normalizer/src/detect.spec.ts
// ---------------------------------------------------------------------------

function mov(hash, sourceMovementId = null) {
  return {
    sourceKind: 'datajud',
    sourceMovementId,
    occurredAt: '2024-01-01T00:00:00.000Z',
    categoryCode: '26',
    categoryLabel: 'Distribuição',
    description: 'x',
    raw: {},
    contentHash: hash,
    needsReview: false,
  };
}
function known(hash, sid = null) {
  return { contentHash: hash, sourceMovementId: sid };
}

function detectVector(name, input) {
  const out = detectChanges(input);
  return {
    name,
    input,
    expected: {
      stateHash: out.stateHash,
      newMovementContentHashes: out.newMovements.map((m) => m.contentHash),
      amendedMovements: out.amendedMovements.map((a) => ({
        contentHash: a.movement.contentHash,
        revisesContentHash: a.revisesContentHash,
      })),
      eventTypes: out.events.map((e) => e.eventType),
      firstSyncCompleted: out.firstSyncCompleted,
    },
  };
}

const inputOrderB_A = { canonical: [mov('b'), mov('a')], known: [], isFirstSync: false, allowFirstSyncComplete: true };
const inputOrderA_B = { canonical: [mov('a'), mov('b')], known: [], isFirstSync: false, allowFirstSyncComplete: true };
const vecOrderBA = detectVector('state_hash independe da ordem de entrada (b,a)', inputOrderB_A);
const vecOrderAB = detectVector('state_hash independe da ordem de entrada (a,b)', inputOrderA_B);

const detectChangesVectors = [
  detectVector('1ª sincronização: só first_sync_completed, sem new_movement', {
    canonical: [mov('a'), mov('b')],
    known: [],
    isFirstSync: true,
    allowFirstSyncComplete: true,
  }),
  detectVector('1ª sincronização parcial: não fecha first_sync_completed', {
    canonical: [mov('a')],
    known: [],
    isFirstSync: true,
    allowFirstSyncComplete: false,
  }),
  detectVector('coleta seguinte: content_hash novo ⇒ new_movement', {
    canonical: [mov('a'), mov('c')],
    known: [known('a'), known('b')],
    isFirstSync: false,
    allowFirstSyncComplete: true,
  }),
  detectVector('idempotência: reprocessar os mesmos hashes ⇒ 0 eventos', {
    canonical: [mov('a'), mov('b')],
    known: [known('a'), known('b')],
    isFirstSync: false,
    allowFirstSyncComplete: true,
  }),
  detectVector('movimentação alterada: mesmo source_movement_id, hash diferente ⇒ movement_amended', {
    canonical: [mov('a2', 'S1')],
    known: [known('a1', 'S1')],
    isFirstSync: false,
    allowFirstSyncComplete: true,
  }),
  vecOrderBA,
  vecOrderAB,
];

const detectChangesInvariants = [
  {
    name: 'state_hash é estável e independe da ordem de entrada',
    equalStateHashOf: [vecOrderBA.name, vecOrderAB.name],
  },
];

// ---------------------------------------------------------------------------
// classify-error.json — espelha packages/collector-engine/src/engine.spec.ts
// (describe('runCollection — falhas')): o que MockSourceAdapter lança e o
// que classifyError devolve. Testado direto em classifyError (mesmo caminho
// que runCollection usa dentro do catch), sem precisar serializar o mock.
// ---------------------------------------------------------------------------

function classifyVector(name, err) {
  return { name, expected: classifyError(err) };
}

const classifyErrorVectors = [
  classifyVector('CollectionTimeoutError (default) ⇒ timeout, retriable', new CollectionTimeoutError()),
  classifyVector('CollectionUnavailableError (default) ⇒ unavailable, retriable', new CollectionUnavailableError()),
  classifyVector('CollectionRateLimitedError (default) ⇒ rate_limited, retriable, httpStatus=429', new CollectionRateLimitedError()),
  classifyVector('CollectionAuthError (default) ⇒ auth_failed, não retriable, httpStatus=401', new CollectionAuthError()),
  classifyVector('CollectionParseError (default) ⇒ parse_error, não retriable', new CollectionParseError()),
  classifyVector('CollectionNotFoundError (default) ⇒ not_found, não retriable, httpStatus=404', new CollectionNotFoundError()),
  classifyVector('Error genérico ⇒ unknown, retriable (limitado)', new Error('boom')),
  classifyVector(
    "SourceUnavailableError (collectors-core) ⇒ unavailable, retriable",
    new SourceUnavailableError('datajud', 'simulado'),
  ),
  classifyVector(
    'SourceNotRegisteredError (collectors-core) ⇒ unknown, não retriable',
    new SourceNotRegisteredError('minha-fonte'),
  ),
];

// ---------------------------------------------------------------------------
// run-collection.json — espelha packages/collector-engine/src/engine.spec.ts
// (runCollection). Fonte determinística inline (não o MockSourceAdapter) para
// que TUDO no `expected` seja pinável, exceto `collectedAt` no caminho de
// FALHA — nesse caminho o TS usa `new Date().toISOString()` capturado antes do
// fetch, que é wall-clock; por isso o script remove `collectedAt` do
// `expected` das falhas e o teste Go não o compara nesse caso.
// ---------------------------------------------------------------------------

const FIXED_COLLECTED_AT = '2024-05-01T00:00:00.000Z';
const RUN_TARGET = { cnjNumber: '0000001-23.2024.8.04.0001', courtId: 'court-1' };

function makeFetchError(name, kind) {
  switch (name) {
    case 'timeout':
      return new CollectionTimeoutError();
    case 'unavailable':
      return new CollectionUnavailableError();
    case 'source_unavailable':
      return new SourceUnavailableError(kind, 'simulado');
    case 'rate_limited':
      return new CollectionRateLimitedError();
    case 'auth_failed':
      return new CollectionAuthError();
    case 'parse_error':
      return new CollectionParseError();
    case 'not_found':
      return new CollectionNotFoundError();
    default:
      throw new Error(`makeFetchError: nome desconhecido ${name}`);
  }
}

function deterministicSource({ kind = 'datajud', movements = [], partial = false, throwWith = null }) {
  return {
    kind,
    canHandle: () => true,
    fetch: async () => {
      if (throwWith) throw makeFetchError(throwWith, kind);
      const result = { sourceKind: kind, collectedAt: FIXED_COLLECTED_AT, movements };
      return partial ? { ...result, partial: true } : result;
    },
  };
}

async function runCollectionVector(name, opts) {
  const {
    sourceKind = 'datajud',
    isFirstSync,
    known = [],
    previousStateHash = null,
    movements = [],
    partial = false,
    throwWith = null,
  } = opts;

  // grava, em ordem de chamada, o que o resolvedor de teste devolveu — o teste
  // Go faz playback sequencial disso, sem replicar o regex.
  const categoryResolutions = [];
  const resolveCategory = (h) => {
    const r = testResolveCategory(h);
    categoryResolutions.push(r);
    return r;
  };

  const out = await runCollection({
    source: deterministicSource({ kind: sourceKind, movements, partial, throwWith }),
    target: RUN_TARGET,
    isFirstSync,
    known,
    previousStateHash,
    sourceKind,
    resolveCategory,
  });

  const expected = { ...out };
  if (out.status === 'failed') delete expected.collectedAt;

  return {
    name,
    input: { sourceKind, isFirstSync, known, previousStateHash },
    fetch: { throw: throwWith, movements, partial },
    categoryResolutions,
    expected,
  };
}

const runCollectionVectors = [];

// engine.spec.ts — describe('runCollection — sucesso') #1
runCollectionVectors.push(
  await runCollectionVector('1ª coleta: 2 movimentos, is_first_sync, só first_sync_completed', {
    isFirstSync: true,
    known: [],
    movements: [
      rawMovement({ description: 'Distribuído', occurredAt: '2024-03-01T00:00:00Z', sourceMovementId: 'S1' }),
      rawMovement({ description: 'Juntada', occurredAt: '2024-03-05T00:00:00Z', sourceMovementId: 'S2' }),
    ],
  }),
);

// engine.spec.ts #2 — 3 passos encadeados (o `known` de cada passo vem do anterior)
{
  const m1 = rawMovement({ description: 'Distribuído', occurredAt: '2024-03-01T00:00:00Z', sourceMovementId: 'S1' });
  const m2 = rawMovement({ description: 'Juntada', occurredAt: '2024-03-05T00:00:00Z', sourceMovementId: 'S2' });

  const s1 = await runCollectionVector('coleta seguinte (passo 1: 1ª coleta com 1 movimento)', {
    isFirstSync: true,
    known: [],
    movements: [m1],
  });
  const s1Known = s1.expected.movements.map((m) => ({
    contentHash: m.content_hash,
    sourceMovementId: m.source_movement_id,
  }));

  const s2 = await runCollectionVector('coleta seguinte (passo 2: +1 movimento ⇒ new_movement)', {
    isFirstSync: false,
    known: s1Known,
    movements: [m1, m2],
  });
  const s2Known = [
    ...s1Known,
    ...s2.expected.movements
      .filter((m) => !s1Known.some((k) => k.contentHash === m.content_hash))
      .map((m) => ({ contentHash: m.content_hash, sourceMovementId: m.source_movement_id })),
  ];

  const s3 = await runCollectionVector('coleta seguinte (passo 3: reprocessa ⇒ 0 novos, 0 eventos)', {
    isFirstSync: false,
    known: s2Known,
    movements: [m1, m2],
  });

  runCollectionVectors.push(s1, s2, s3);
}

// engine.spec.ts #3 — movimentação alterada (2 passos)
{
  const v1 = rawMovement({ description: 'Decisão proferida', occurredAt: '2024-04-01T00:00:00Z', sourceMovementId: 'S9' });
  const a1 = await runCollectionVector('movimentação alterada (passo 1: 1ª coleta)', {
    isFirstSync: true,
    known: [],
    movements: [v1],
  });
  const a1Known = a1.expected.movements.map((m) => ({
    contentHash: m.content_hash,
    sourceMovementId: m.source_movement_id,
  }));
  const v2 = rawMovement({
    description: 'Decisão proferida (retificada)',
    occurredAt: '2024-04-01T00:00:00Z',
    sourceMovementId: 'S9',
  });
  const a2 = await runCollectionVector('movimentação alterada (passo 2: revises_content_hash + movement_amended)', {
    isFirstSync: false,
    known: a1Known,
    movements: [v2],
  });
  runCollectionVectors.push(a1, a2);
}

// engine.spec.ts #4 — coleta parcial
runCollectionVectors.push(
  await runCollectionVector('coleta parcial: status partial, sem first_sync_completed', {
    isFirstSync: true,
    known: [],
    movements: [rawMovement({ description: 'p1' })],
    partial: true,
  }),
);

// engine.spec.ts — describe('runCollection — falhas') it.each
for (const failWith of ['timeout', 'unavailable', 'rate_limited', 'auth_failed', 'parse_error', 'not_found']) {
  runCollectionVectors.push(
    await runCollectionVector(`falha: ${failWith}`, { isFirstSync: true, known: [], throwWith: failWith }),
  );
}

// engine.spec.ts — SourceUnavailableError vira unavailable/retriável
runCollectionVectors.push(
  await runCollectionVector('falha: SourceUnavailableError (collectors-core) ⇒ unavailable/retriável', {
    isFirstSync: true,
    known: [],
    throwWith: 'source_unavailable',
  }),
);

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

const files = {
  'normalize-movement.json': { vectors: normalizeMovementVectors, invariants: normalizeMovementInvariants },
  'detect-changes.json': { vectors: detectChangesVectors, invariants: detectChangesInvariants },
  'classify-error.json': { vectors: classifyErrorVectors, invariants: [] },
  'run-collection.json': { vectors: runCollectionVectors, invariants: [] },
};

for (const [file, content] of Object.entries(files)) {
  writeFileSync(join(outDir, file), JSON.stringify(content, null, 2) + '\n', 'utf8');
}

const total = Object.values(files).reduce((n, f) => n + f.vectors.length, 0);
console.error(`Vetores de contrato gravados em contracts/collector-engine/: ${total} vetores em ${Object.keys(files).length} arquivos.`);
