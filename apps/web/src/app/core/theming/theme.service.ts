import { Injectable, signal } from '@angular/core';
import { updatePreset, updatePrimaryPalette } from '@primeng/themes';
import { generatePalette } from './palette';

const DARK_CLASS = 'app-dark';
const STORAGE_KEY = 'juriflow.darkMode';
const DEFAULT_PRIMARY = '#2563eb';

/**
 * Duas responsabilidades de tema, ambas globais (não por componente):
 * 1) modo claro/escuro — preferência do usuário, persistida no navegador;
 * 2) cor primária/secundária do espaço ativo — aplicada via a API de runtime
 *    do PrimeNG (`updatePrimaryPalette`), não é um preset por espaço fixo.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _isDark = signal(this.readInitialDarkMode());
  readonly isDark = this._isDark.asReadonly();

  constructor() {
    this.applyDarkClass(this._isDark());
  }

  toggleDark(): void {
    this.setDark(!this._isDark());
  }

  setDark(value: boolean): void {
    this._isDark.set(value);
    this.applyDarkClass(value);
    try {
      localStorage.setItem(STORAGE_KEY, value ? 'dark' : 'light');
    } catch {
      /* localStorage indisponível (modo privado) — segue só em memória. */
    }
  }

  /**
   * Uso das cores, definido pelo cliente: no botão padrão (severity
   * primária — "Salvar", "Criar", "Entrar"…), o FUNDO é a cor primária e a
   * LETRA/ÍCONE é a cor secundária (ex.: botão azul com texto dourado). Nos
   * botões de ação secundária (Cancelar, Limpar — severity="secondary"),
   * texto/borda usam a cor secundária cheia (não um tom claro/apagado),
   * sempre com contraste visível contra o fundo.
   */
  applySpaceColors(primary: string, secondary: string | null): void {
    const secondaryHex = secondary || primary;
    const palette = generatePalette(primary);
    updatePrimaryPalette(palette);
    const root = document.documentElement.style;
    root.setProperty('--jf-primary', primary);
    root.setProperty('--jf-primary-strong', palette['700']);
    root.setProperty('--jf-secondary', secondaryHex);
    this.applyButtonPalette(secondaryHex);
  }

  /** Sem espaço ativo (ex.: SUPER_ADMIN) — volta à cor padrão da plataforma. */
  resetSpaceColors(): void {
    this.applySpaceColors(DEFAULT_PRIMARY, null);
  }

  /**
   * Sobrescreve só os tokens de botão do PrimeNG (nunca `surface`, usado em
   * cards/tabelas/bordas — mudar isso afetaria a UI inteira, não só botões).
   */
  private applyButtonPalette(secondaryHex: string): void {
    const pal = generatePalette(secondaryHex);
    const secondaryOnPrimary = {
      color: secondaryHex,
      hoverColor: secondaryHex,
      activeColor: secondaryHex,
    };
    // Todo estado (normal/hover/active) definido explicitamente — nada fica
    // "sem valor" pra herdar o cinza quase-branco padrão do PrimeNG, que se
    // perdia contra o fundo branco do card.
    const secondaryLight = {
      background: 'transparent',
      hoverBackground: pal['100'],
      activeBackground: pal['200'],
      borderColor: secondaryHex,
      hoverBorderColor: pal['700'],
      activeBorderColor: pal['800'],
      color: secondaryHex,
      hoverColor: pal['700'],
      activeColor: pal['800'],
      focusRing: { color: secondaryHex, shadow: 'none' },
    };
    const secondaryDark = {
      background: 'transparent',
      hoverBackground: pal['800'],
      activeBackground: pal['700'],
      borderColor: secondaryHex,
      hoverBorderColor: pal['300'],
      activeBorderColor: pal['200'],
      color: secondaryHex,
      hoverColor: pal['300'],
      activeColor: pal['200'],
      focusRing: { color: secondaryHex, shadow: 'none' },
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
            dark: {
              root: { primary: secondaryOnPrimary, secondary: secondaryDark },
              outlined: { secondary: secondaryDark },
              text: { secondary: secondaryDark },
            },
          },
        },
      },
    });
  }

  private applyDarkClass(isDark: boolean): void {
    document.documentElement.classList.toggle(DARK_CLASS, isDark);
  }

  private readInitialDarkMode(): boolean {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return stored === 'dark';
    } catch {
      /* localStorage indisponível — cai para a preferência do sistema. */
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  }
}
