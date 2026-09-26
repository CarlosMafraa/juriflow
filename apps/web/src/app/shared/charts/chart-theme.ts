/**
 * O Chart.js desenha em <canvas>, que não entende `var(--token)`. Estas funções
 * leem os tokens de styles.scss na hora de montar o gráfico — a paleta continua
 * definida num lugar só.
 */
export function cssColor(value: string): string {
  const match = /^var\((--[\w-]+)\)$/.exec(value.trim());
  if (!match || typeof document === 'undefined') return value;
  return getComputedStyle(document.documentElement).getPropertyValue(match[1]!).trim() || value;
}

export function chartFont(size = 11): { family: string; size: number } {
  const family =
    typeof document === 'undefined'
      ? 'system-ui, sans-serif'
      : getComputedStyle(document.body).fontFamily;
  return { family, size };
}
