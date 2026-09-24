import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { ThemeService } from '../theming/theme.service';

const STORAGE_KEY = 'juriflow.activeSpaceId';

/**
 * Espaço atualmente selecionado. Um usuário pode pertencer a vários espaços
 * (ver `space_members`); esta é a escolha de contexto da sessão.
 */
@Injectable({ providedIn: 'root' })
export class ActiveSpaceService {
  private readonly auth = inject(AuthService);
  private readonly theme = inject(ThemeService);
  private readonly _activeSpaceId = signal<string | null>(this.readStored());

  readonly activeSpaceId = this._activeSpaceId.asReadonly();

  /** Espaços com vínculo ativo, para o seletor. */
  readonly availableSpaces = computed(() =>
    this.auth
      .memberships()
      .filter((m) => m.status === 'active')
      .map((m) => ({
        id: m.spaceId,
        name: m.spaceName ?? m.spaceId,
        color: m.spaceColor ?? '#94a3b8',
        secondaryColor: m.spaceSecondaryColor ?? null,
        role: m.role,
      })),
  );

  readonly activeSpace = computed(
    () => this.availableSpaces().find((s) => s.id === this._activeSpaceId()) ?? null,
  );

  constructor() {
    // Mantém a seleção válida conforme os vínculos mudam (login/logout/troca).
    // allowSignalWrites: o efeito lê `_activeSpaceId` e pode escrever nele
    // mesmo (corrigir para um valor válido) — padrão suportado pelo Angular.
    effect(
      () => {
        const spaces = this.availableSpaces();
        const current = this._activeSpaceId();
        if (spaces.length === 0) {
          if (current !== null) this.setActiveSpace(null);
          return;
        }
        if (!current || !spaces.some((s) => s.id === current)) {
          this.setActiveSpace(spaces[0]!.id);
        }
      },
      { allowSignalWrites: true },
    );

    // Cor do espaço vira a cor primária/secundária do app (RN: cada espaço
    // define o próprio tema); sem espaço ativo, volta à cor padrão.
    effect(() => {
      const space = this.activeSpace();
      if (space) this.theme.applySpaceColors(space.color, space.secondaryColor);
      else this.theme.resetSpaceColors();
    });
  }

  setActiveSpace(spaceId: string | null): void {
    this._activeSpaceId.set(spaceId);
    try {
      if (spaceId) localStorage.setItem(STORAGE_KEY, spaceId);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* localStorage indisponível (modo privado) — segue só em memória. */
    }
  }

  private readStored(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }
}
