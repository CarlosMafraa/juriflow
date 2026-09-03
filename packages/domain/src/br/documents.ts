/**
 * Utilitários puros para documentos brasileiros usados na Fase 3.
 * Espelham as regras aplicadas no banco (formato do CNJ, dígitos do CPF/CNPJ).
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

function checksum(digits: string, weights: number[]): number {
  const sum = weights.reduce((acc, w, i) => acc + Number(digits[i]) * w, 0);
  const mod = sum % 11;
  return mod < 2 ? 0 : 11 - mod;
}

export function isValidCpf(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const d1 = checksum(d, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = checksum(d, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(d[9]) && d2 === Number(d[10]);
}

export function isValidCnpj(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const d1 = checksum(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = checksum(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(d[12]) && d2 === Number(d[13]);
}

/** Valida o documento conforme o tipo do cliente. Vazio/`null` é válido (documento é opcional). */
export function isValidClientDocument(type: 'PF' | 'PJ', value: string | null | undefined): boolean {
  if (value == null || onlyDigits(value) === '') return true;
  return type === 'PF' ? isValidCpf(value) : isValidCnpj(value);
}
