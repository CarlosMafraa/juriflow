const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** Normaliza texto para EXIBIÇÃO: trim + colapso de espaços. */
export function normalizeDescription(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Normaliza texto para o HASH de conteúdo (determinístico e estável):
 * minúsculas, sem acentos, sem pontuação irrelevante, espaços colapsados.
 */
export function normalizeForHash(value: string): string {
  return value
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Data (ISO) truncada ao dia (UTC), ou string vazia se ausente/inválida. */
export function isoDay(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}
