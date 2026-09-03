import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterOutlet } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { map } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';
import { SidebarComponent } from './sidebar.component';

/** Breakpoints do brief: Mobile <768, Tablet 768–1023, Desktop >=1024. */
export const DESKTOP_QUERY = '(min-width: 1024px)';

@Component({
  selector: 'jf-auth-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, SidebarComponent],
  template: `
    <div class="layout" [class.layout--desktop]="isDesktop()">
      <header class="topbar">
        @if (!isDesktop()) {
          <button
            type="button"
            class="topbar__toggle"
            [attr.aria-expanded]="drawerOpen()"
            aria-label="Alternar menu"
            (click)="toggleDrawer()"
          >
            ☰
          </button>
        }
        <span class="topbar__brand">JuriFlow</span>

        <div class="topbar__spacer"></div>

        @if (spaces().length > 1) {
          <label class="topbar__space">
            <span class="sr-only">Espaço ativo</span>
            <select
              [value]="activeSpaceId() ?? ''"
              (change)="onSpaceChange($event)"
              aria-label="Espaço ativo"
            >
              @for (space of spaces(); track space.id) {
                <option [value]="space.id">{{ space.name }}</option>
              }
            </select>
          </label>
        } @else if (spaces().length === 1) {
          <span class="topbar__space-name">{{ spaces()[0].name }}</span>
        }

        <button type="button" class="topbar__signout" (click)="signOut()">Sair</button>
      </header>

      <div class="body">
        @if (isDesktop() || drawerOpen()) {
          <aside class="drawer" [class.drawer--overlay]="!isDesktop()">
            <jf-sidebar (navigate)="closeDrawer()" />
          </aside>
        }
        @if (!isDesktop() && drawerOpen()) {
          <div class="scrim" (click)="closeDrawer()" aria-hidden="true"></div>
        }

        <main class="main" id="main-content">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
  styles: [
    `
      .layout {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
        background: var(--jf-bg, #f8fafc);
      }
      .topbar {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.6rem 1rem;
        background: var(--jf-surface, #fff);
        border-bottom: 1px solid var(--jf-border, #e2e8f0);
        position: sticky;
        top: 0;
        z-index: 20;
      }
      .topbar__toggle,
      .topbar__signout {
        font: inherit;
        border: 1px solid var(--jf-border, #cbd5e1);
        background: var(--jf-surface, #fff);
        border-radius: var(--jf-radius, 8px);
        padding: 0.35rem 0.7rem;
        cursor: pointer;
      }
      .topbar__brand {
        font-weight: 800;
        letter-spacing: 0.02em;
      }
      .topbar__spacer {
        flex: 1;
      }
      .topbar__space select {
        font: inherit;
        padding: 0.3rem 0.5rem;
        border-radius: var(--jf-radius, 8px);
        border: 1px solid var(--jf-border, #cbd5e1);
      }
      .topbar__space-name {
        font-size: 0.85rem;
        color: var(--jf-text-muted, #64748b);
      }
      .body {
        flex: 1;
        display: flex;
        position: relative;
      }
      .drawer {
        width: 15rem;
        background: var(--jf-surface, #fff);
        border-right: 1px solid var(--jf-border, #e2e8f0);
      }
      .drawer--overlay {
        position: fixed;
        top: 3.1rem;
        bottom: 0;
        left: 0;
        z-index: 30;
        box-shadow: 0 12px 40px rgb(15 23 42 / 20%);
      }
      .scrim {
        position: fixed;
        inset: 3.1rem 0 0;
        background: rgb(15 23 42 / 35%);
        z-index: 25;
      }
      .main {
        flex: 1;
        padding: 1.25rem;
        max-width: 72rem;
        margin: 0 auto;
        width: 100%;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      @media (min-width: 1024px) {
        .main {
          padding: 1.75rem;
        }
      }
    `,
  ],
})
export class AuthLayoutComponent {
  private readonly auth = inject(AuthService);
  private readonly activeSpace = inject(ActiveSpaceService);
  private readonly router = inject(Router);
  private readonly breakpoints = inject(BreakpointObserver);

  protected readonly isDesktop = toSignal(
    this.breakpoints.observe(DESKTOP_QUERY).pipe(map((s) => s.matches)),
    { initialValue: false },
  );

  private readonly _drawerOpen = signal(false);
  protected readonly drawerOpen = this._drawerOpen.asReadonly();

  protected readonly spaces = computed(() => this.activeSpace.availableSpaces());
  protected readonly activeSpaceId = this.activeSpace.activeSpaceId;

  protected toggleDrawer(): void {
    this._drawerOpen.update((v) => !v);
  }
  protected closeDrawer(): void {
    this._drawerOpen.set(false);
  }

  protected onSpaceChange(event: Event): void {
    this.activeSpace.setActiveSpace((event.target as HTMLSelectElement).value || null);
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigate(['/login']);
  }
}
