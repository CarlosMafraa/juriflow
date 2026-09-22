import { createHash } from 'node:crypto';
import type { RawMovement } from '@juriflow/collectors-core';

/**
 * Funções puras (sem I/O) de hashing usadas pelo pipeline de acompanhamento.
 * Isoladas do resto do domínio para poderem ser testadas sem mocks.
 */

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Hash determinístico de UMA movimentação — base da deduplicação (RN16).
 * Prioriza `sourceMovementId` quando a fonte fornece um id estável; cai para
 * descrição + data quando não fornece (ex.: HTML sem id, só texto da tabela).
 */
export function computeMovementContentHash(movement: RawMovement): string {
  const identity =
    movement.sourceMovementId ?? `${movement.description.trim()}|${movement.occurredAt ?? ''}`;
  return sha256(`${movement.sourceKind}|${identity}`);
}

/**
 * Hash do conjunto completo de movimentações conhecidas de um processo.
 * Base para o `state_hash` da Fase 9 (motor de mudanças) — aqui usado apenas
 * para marcar se já houve a 1ª coleta (RN11): `null` ⇒ nunca coletado.
 */
export function computeStateHash(contentHashes: readonly string[]): string {
  const sorted = [...contentHashes].sort();
  return sha256(sorted.join(','));
}
