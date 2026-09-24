import { Injectable, signal } from '@angular/core';
import { updatePrimaryPalette } from '@primeng/themes';
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
   * Cor primária (botões PrimeNG via `updatePrimaryPalette` + `--jf-primary`,
   * usado nos componentes custom desta app) e secundária (acentos, ex.: item
   * ativo da sidebar).
   */
  applySpaceColors(primary: string, secondary: string | null): void {
    const palette = generatePalette(primary);
    updatePrimaryPalette(palette);
    const root = document.documentElement.style;
    root.setProperty('--jf-primary', primary);
    root.setProperty('--jf-primary-strong', palette['700']);
    root.setProperty('--jf-secondary', secondary || primary);
  }

  /** Sem espaço ativo (ex.: SUPER_ADMIN) — volta à cor padrão da plataforma. */
  resetSpaceColors(): void {
    this.applySpaceColors(DEFAULT_PRIMARY, null);
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
