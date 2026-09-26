/**
 * Tipo de movimentação = título da movimentação na fonte, normalizado para
 * servir de chave do filtro de notificação (docs/REGRAS-DE-NEGOCIO.md, N4–N6).
 * Funções puras, sem I/O.
 */

/**
 * Títulos que trazem o NOME DA PARTE no fim ("DECORRIDO PRAZO DE FULANO").
 * O nome sai do tipo: a lista de tipos não pode virar cadastro de partes
 * (LGPD) e um mesmo toggle precisa valer para qualquer parte.
 */
const TITLES_WITH_PARTY_NAME: readonly RegExp[] = [
  /^(DECORRIDO PRAZO) DE .+$/,
  /^(RENÚNCIA DE PRAZO) DE .+$/,
];

/** "  expedição   de intimação " → "EXPEDIÇÃO DE INTIMAÇÃO"; sem título → null. */
export function normalizeMovementType(title: string | null | undefined): string | null {
  const clean = (title ?? '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('pt-BR');
  if (!clean) return null;
  for (const pattern of TITLES_WITH_PARTY_NAME) {
    const match = clean.match(pattern);
    if (match) return match[1];
  }
  return clean;
}

/** Chave de comparação: ignora acentos, caixa e espaços extras. */
export function movementTypeKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/** Para quem um tipo de movimentação deve ser avisado. */
export interface MovementTypeAudiences {
  readonly responsible: boolean;
  readonly client: boolean;
}

/** Tipo fora da lista (ou movimentação sem tipo) é avisado: nada some sem alguém escolher. */
export const NOTIFY_EVERYONE: MovementTypeAudiences = { responsible: true, client: true };

/**
 * Toggles efetivos de um processo: o que o processo personalizou vence; o
 * resto segue o padrão do escritório.
 */
export function mergeMovementTypeAudiences(
  spaceDefaults: ReadonlyMap<string, MovementTypeAudiences>,
  processOverrides: ReadonlyMap<string, MovementTypeAudiences>,
): (movementType: string | null) => MovementTypeAudiences {
  const byKey = new Map<string, MovementTypeAudiences>();
  for (const [name, audiences] of spaceDefaults) byKey.set(movementTypeKey(name), audiences);
  for (const [name, audiences] of processOverrides) byKey.set(movementTypeKey(name), audiences);
  return (movementType) =>
    movementType ? (byKey.get(movementTypeKey(movementType)) ?? NOTIFY_EVERYONE) : NOTIFY_EVERYONE;
}
