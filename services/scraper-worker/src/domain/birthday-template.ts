/**
 * Mensagem de aniversário (N14). Placeholders: {{nome}} (primeiro nome) e
 * {{escritorio}} (nome do espaço).
 */
export function renderBirthdayMessage(
  body: string,
  input: { fullName: string; spaceName: string },
): string {
  const firstName = input.fullName.trim().split(/\s+/)[0] ?? input.fullName;
  return body.replaceAll('{{nome}}', firstName).replaceAll('{{escritorio}}', input.spaceName);
}

/** Data de hoje (AAAA-MM-DD) no fuso do escritório. */
export function localDay(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
