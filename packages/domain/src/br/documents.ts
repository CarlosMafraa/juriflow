/**
 * Utilitários puros para documentos brasileiros usados na Fase 3.
 * Espelham as regras aplicadas no banco (formato do CNJ). CPF/CNPJ não existem
 * mais no sistema (LGPD, migração 0048).
 */

export function onlyDigits(value: string): string {
  return value.replace(/\D+/g, '');
}

/** CNJ formatado: `NNNNNNN-DD.AAAA.J.TR.OOOO`. */
export const CNJ_PATTERN = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;

export function isFormattedCnj(value: string): boolean {
  return CNJ_PATTERN.test(value);
}

/** Recebe entrada livre; devolve o CNJ mascarado se houver 20 dígitos, senão `null`. */
export function formatCnjNumber(input: string): string | null {
  const d = onlyDigits(input);
  if (d.length !== 20) return null;
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`;
}
