import { generatePalette } from './palette';

describe('generatePalette', () => {
  it('mantém o tom 500 igual à cor escolhida', () => {
    const palette = generatePalette('#2563eb');
    expect(palette['500']).toBe('#2563eb');
  });

  it('gera os 11 tons esperados pelo PrimeNG, todos em hex válido', () => {
    const palette = generatePalette('#16a34a');
    const shades = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
    expect(Object.keys(palette).sort()).toEqual(shades.sort());
    for (const shade of shades) {
      expect(palette[shade]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('tons mais baixos são mais claros que os mais altos (mesma matiz)', () => {
    const palette = generatePalette('#9333ea');
    const toLightness = (hex: string): number => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
    };
    expect(toLightness(palette['50'])).toBeGreaterThan(toLightness(palette['500']));
    expect(toLightness(palette['500'])).toBeGreaterThan(toLightness(palette['950']));
  });
});
