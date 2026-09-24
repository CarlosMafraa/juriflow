import { Injectable } from '@angular/core';
import { updatePreset, updatePrimaryPalette } from '@primeng/themes';
import { generatePalette } from './palette';

const PRIMARY = '#1f385d';
const PRIMARY_STRONG = '#11284b';
const SECONDARY = '#d7a040';

/**
 * Tema fixo do app inteiro — o azul/dourado do login (única cor, sem
 * customização por espaço nem modo escuro). Já tentamos os dois e não
 * ficaram bons; um tema fixo e simples é o que fica.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  constructor() {
    this.applyFixedTheme();
  }

  private applyFixedTheme(): void {
    const palette = generatePalette(PRIMARY);
    updatePrimaryPalette(palette);
    const root = document.documentElement.style;
    root.setProperty('--jf-primary', PRIMARY);
    root.setProperty('--jf-primary-strong', PRIMARY_STRONG);
    root.setProperty('--jf-secondary', SECONDARY);
    this.applyButtonPalette(SECONDARY);
  }

  /**
   * Sobrescreve só os tokens de botão do PrimeNG (nunca `surface`, usado em
   * cards/tabelas/bordas). Botão padrão: fundo primário, letra/ícone
   * dourados. Botões secondary (Cancelar, Limpar): texto fixo num tom
   * escuro do dourado (contraste garantido contra o card branco — a cor
   * crua é clara e sozinha não contrasta com nada); nas variantes
   * outlined/text o PrimeNG não muda a cor do texto no hover, só o fundo,
   * por isso o hover usa um tom claro que contrasta com esse texto fixo.
   */
  private applyButtonPalette(secondaryHex: string): void {
    const pal = generatePalette(secondaryHex);
    const secondaryOnPrimary = {
      color: secondaryHex,
      hoverColor: secondaryHex,
      activeColor: secondaryHex,
    };
    const secondaryLight = {
      background: 'transparent',
      hoverBackground: pal['100'],
      activeBackground: pal['200'],
      borderColor: pal['700'],
      hoverBorderColor: pal['700'],
      activeBorderColor: pal['800'],
      color: pal['700'],
      focusRing: { color: pal['700'], shadow: 'none' },
    };
    updatePreset({
      components: {
        button: {
          colorScheme: {
            light: {
              root: { primary: secondaryOnPrimary, secondary: secondaryLight },
              outlined: { secondary: secondaryLight },
              text: { secondary: secondaryLight },
            },
          },
        },
      },
    });
  }
}
