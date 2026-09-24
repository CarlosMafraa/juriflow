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
   * Padrão de mercado (Material Design, regra 60-30-10): primária é a cor
   * dominante — aplicada em tudo via `updatePrimaryPalette` + `--jf-primary`,
   * usado pelos componentes custom desta app. Secundária é o suporte — pinta
   * os botões `severity="secondary"` do PrimeNG (Cancelar, Limpar etc., hoje
   * cinza fixo) e acentos pontuais (ex.: ícone do item ativo da sidebar).
   */
  applySpaceColors(primary: string, secondary: string | null): void {
    const palette = generatePalette(primary);
    updatePrimaryPalette(palette);
    const root = document.documentElement.style;
    root.setProperty('--jf-primary', primary);
    root.setProperty('--jf-primary-strong', palette['700']);
    root.setProperty('--jf-secondary', secondary || primary);
    this.applySecondaryButtonPalette(secondary || primary);
  }

  /** Sem espaço ativo (ex.: SUPER_ADMIN) — volta à cor padrão da plataforma. */
  resetSpaceColors(): void {
    this.applySpaceColors(DEFAULT_PRIMARY, null);
  }

  /**
   * PrimeNG não tem um conceito de "cor secundária de marca" pronto — a
   * severity="secondary" dos botões usa a paleta neutra `surface` fixa.
   * Sobrescreve só os tokens de botão (root/outlined/text, claro/escuro)
   * com uma escala derivada da cor secundária do espaço, sem tocar `surface`
   * (usado em cards/tabelas/bordas — mudar isso afetaria a UI inteira).
   */
  private applySecondaryButtonPalette(secondaryHex: string): void {
    const pal = generatePalette(secondaryHex);
    updatePreset({
      components: {
        button: {
          colorScheme: {
            light: {
              root: {
                secondary: {
                  background: pal['100'],
                  hoverBackground: pal['200'],
                  activeBackground: pal['300'],
                  borderColor: pal['100'],
                  hoverBorderColor: pal['200'],
                  activeBorderColor: pal['300'],
                  color: pal['700'],
                  hoverColor: pal['800'],
                  activeColor: pal['900'],
                  focusRing: { color: pal['600'], shadow: 'none' },
                },
              },
              outlined: {
                secondary: {
                  hoverBackground: pal['50'],
                  activeBackground: pal['100'],
                  borderColor: pal['200'],
                  color: pal['700'],
                },
              },
              text: {
                secondary: {
                  hoverBackground: pal['50'],
                  activeBackground: pal['100'],
                  color: pal['700'],
                },
              },
            },
            dark: {
              root: {
                secondary: {
                  background: pal['800'],
                  hoverBackground: pal['700'],
                  activeBackground: pal['600'],
                  borderColor: pal['800'],
                  hoverBorderColor: pal['700'],
                  activeBorderColor: pal['600'],
                  color: pal['200'],
                  hoverColor: pal['100'],
                  activeColor: pal['50'],
                  focusRing: { color: pal['300'], shadow: 'none' },
                },
              },
              outlined: {
                secondary: {
                  hoverBackground: 'rgba(255,255,255,0.04)',
                  activeBackground: 'rgba(255,255,255,0.16)',
                  borderColor: pal['600'],
                  color: pal['300'],
                },
              },
              text: {
                secondary: {
                  hoverBackground: pal['800'],
                  activeBackground: pal['700'],
                  color: pal['300'],
                },
              },
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
