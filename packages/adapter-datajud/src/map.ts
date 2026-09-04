/**
 * Conversão de uma movimentação do DataJud numa `RawMovement` do JuriFlow.
 *
 * Regras (seção 4 do brief):
 *   - `dataHora`  → `occurredAt` (string ISO como veio; `null` se ausente/vazia)
 *   - `codigo`    → `raw.movementCode` (string) — dica de categoria para o normalizador
 *   - `nome`      → `raw.movementLabel`
 *   - `complementosTabelados` → `raw.complementosTabelados` (preservado)
 *   - `sourceMovementId` → SEMPRE `null` (o DataJud não expõe id estável por movimento)
 *   - NUNCA usar o `id`/`numeroProcesso` do processo como id de movimento
 *   - NUNCA derivar id de data+código
 */
import type { RawMovement, SourceKind } from '@juriflow/collectors-core';
import { buildDescription } from './describe.js';
import type { DataJudMovimento, DataJudSource } from './envelope.js';

/** Contexto do processo preservado em cada `raw` para auditoria. */
export interface DataJudProcessContext {
  readonly numeroProcesso: string | null;
  readonly tribunal: string | null;
  readonly grau: string | null;
  readonly classe: DataJudSource['classe'];
  readonly orgaoJulgador: DataJudSource['orgaoJulgador'];
  readonly dataHoraUltimaAtualizacao: string | null;
}

export function buildProcessContext(source: DataJudSource): DataJudProcessContext {
  return {
    numeroProcesso: source.numeroProcesso ?? null,
    tribunal: source.tribunal ?? null,
    grau: source.grau ?? null,
    classe: source.classe ?? null,
    orgaoJulgador: source.orgaoJulgador ?? null,
    dataHoraUltimaAtualizacao: source.dataHoraUltimaAtualizacao ?? null,
  };
}

function normalizeDataHora(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function mapMovimento(
  movimento: DataJudMovimento,
  sourceKind: SourceKind,
  processo: DataJudProcessContext,
): RawMovement {
  const code = movimento.codigo != null ? String(movimento.codigo) : null;
  const label = movimento.nome != null ? String(movimento.nome) : null;
  const complementos = movimento.complementosTabelados ?? [];

  return {
    sourceKind,
    sourceMovementId: null,
    occurredAt: normalizeDataHora(movimento.dataHora),
    description: buildDescription(label, complementos),
    raw: {
      movementCode: code,
      movementLabel: label,
      dataHora: movimento.dataHora ?? null,
      complementosTabelados: complementos,
      processo,
    },
  };
}
