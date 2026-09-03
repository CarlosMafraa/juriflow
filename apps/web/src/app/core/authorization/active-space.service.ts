import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';

const STORAGE_KEY = 'juriflow.activeSpaceId';

/**
 * Espaço atualmente selecionado. Um usuário pode pertencer a vários espaços
 * (ver `space_members`); esta é a escolha de contexto da sessão.
 */
@Injectable({ providedIn: 'root' })
export class ActiveSpaceService {
  private readonly auth = inject(AuthService);
  private readonly _activeSpaceId = signal<string | null>(this.readStored());

  readonly activeSpaceId = this._activeSpaceId.asReadonly();

  /** Espaços com vínculo ativo, para o seletor. */
  readonly availableSpaces = computed(() =>
    this.auth
      .memberships()
      .filter((m) => m.status === 'active')
      .map((m) => ({ id: m.spaceId, name: m.spaceName ?? m.spaceId, role: m.role })),
  );

  readonly activeSpace = computed(
    () => this.availableSpaces().find((s) => s.id === this._activeSpaceId()) ?? null,
  );

  constructor() {
    // Mantém a seleção válida conforme os vínculos mudam (login/logout/troca).
    effect(() => {
      const spaces = this.availableSpaces();
      const current = this._activeSpaceId();
      if (spaces.length === 0) {
        if (current !== null) this.setActiveSpace(null);
        return;
      }
      if (!current || !spaces.some((s) => s.id === current)) {
        this.setActiveSpace(spaces[0]!.id);
      }
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
