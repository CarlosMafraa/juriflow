/**
 * Gera uma paleta de 11 tons (50–950, no formato que o PrimeNG espera em
 * `updatePrimaryPalette`) a partir de uma única cor hex escolhida pelo ADMIN
 * do espaço. O tom 500 é a própria cor escolhida — é o que o PrimeNG usa como
 * `primary.color` (fundo de botão) no modo claro; o resto é derivado variando
 * a luminosidade em HSL, mantendo matiz/saturação.
 */
const SHADE_LIGHTNESS: Record<string, number> = {
  '50': 97,
  '100': 93,
  '200': 84,
  '300': 73,
  '400': 62,
  '500': 51,
  '600': 43,
  '700': 36,
  '800': 30,
  '900': 25,
  '950': 15,
};

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function hexToHsl(hex: string): Hsl {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lNorm - c / 2;

  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const toHex = (v: number): string =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function generatePalette(baseHex: string): Record<string, string> {
  const { h, s } = hexToHsl(baseHex);
  const palette: Record<string, string> = {};
  for (const [shade, lightness] of Object.entries(SHADE_LIGHTNESS)) {
    palette[shade] = shade === '500' ? baseHex : hslToHex(h, s, lightness);
  }
  return palette;
}
