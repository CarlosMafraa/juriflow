import { createHash } from 'node:crypto';

// Separador improvável em texto de movimentação (control char).
const SEP = '';

/** Hash SHA-256 (hex) determinístico de um conjunto ordenado de partes. */
export function sha256Hex(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join(SEP)).digest('hex');
}

/** Hash do conjunto ordenado de `content_hash` conhecidos — o `state_hash`. */
export function stateHashOf(contentHashes: readonly string[]): string {
  const sorted = [...new Set(contentHashes)].sort();
  return sha256Hex(sorted);
}
