import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterOutlet } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { map } from 'rxjs';
import type { MenuItem } from 'primeng/api';
import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { MenuModule } from 'primeng/menu';
import { AuthService } from '../../core/auth/auth.service';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';
import { SidebarComponent } from './sidebar.component';

/** Breakpoints do brief: Mobile <768, Tablet 768–1023, Desktop >=1024. */
export const DESKTOP_QUERY = '(min-width: 1024px)';

function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

@Component({
  selector: 'jf-auth-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, SidebarComponent, AvatarModule, ButtonModule, MenuModule],
  template: `
    <div class="layout" [class.layout--desktop]="isDesktop()">
      <header class="topbar">
        @if (!isDesktop()) {
          <p-button
            icon="pi pi-bars"
            [text]="true"
            severity="secondary"
            [attr.aria-expanded]="drawerOpen()"
            ariaLabel="Alternar menu"
            (onClick)="toggleDrawer()"
          />
        }

        <!-- Identidade do espaço: um usuário pertence a um único espaço (MVP —
             cada espaço é vendido a uma pessoa/e-mail), então é só exibição,
             nunca um seletor de troca. -->
        @if (activeSpace(); as s) {
          <span class="identity">
            <p-avatar [label]="initialOf(s.name)" shape="circle" size="normal" />
            <span class="identity__name">{{ s.name }}</span>
          </span>
        }

        <div class="topbar__spacer"></div>

        <!-- Identidade do usuário — Meu perfil / Sair. -->
        <button type="button" class="identity identity--btn" (click)="userMenu.toggle($event)" aria-label="Menu do usuário">
          <span class="identity__name">{{ userDisplayName() }}</span>
          @if (avatarUrl()) {
            <p-avatar [image]="avatarUrl()!" shape="circle" size="normal" />
          } @else {
            <p-avatar [label]="userInitial()" shape="circle" size="normal" />
          }
          <i class="pi pi-chevron-down identity__chevron" aria-hidden="true"></i>
        </button>
        <p-menu #userMenu [model]="userMenuItems" [popup]="true" />
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
        height: 100vh;
        background: var(--jf-bg, #f8fafc);
      }
      .topbar {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex: none;
        padding: 0.6rem 1rem;
        background: var(--jf-surface, #fff);
        border-bottom: 1px solid var(--jf-border, #e2e8f0);
        position: sticky;
        top: 0;
        z-index: 20;
      }
      .topbar__spacer {
        flex: 1;
      }
      .identity {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.85rem;
        color: var(--jf-text, #0f172a);
      }
      .identity--btn {
        border: none;
        background: transparent;
        padding: 0.25rem 0.4rem;
        border-radius: var(--jf-radius, 8px);
        cursor: pointer;
        font: inherit;
      }
      .identity--btn:hover {
        background: var(--jf-surface-muted, #f1f5f9);
      }
      .identity__name {
        max-width: 10rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .identity__chevron {
        font-size: 0.7rem;
        color: var(--jf-text-muted, #64748b);
      }
      :host ::ng-deep .p-avatar {
        background: var(--jf-primary, #2563eb);
        color: #fff;
        font-weight: 600;
        font-size: 0.8rem;
      }
      .body {
        flex: 1;
        display: flex;
        position: relative;
        /* Sem isso um flex item cresce pelo conteúdo em vez de respeitar a
           altura do pai — aí quem rola é a página inteira, não só o main. */
        min-height: 0;
      }
      .drawer {
        width: 15rem;
        background: var(--jf-surface, #fff);
        border-right: 1px solid var(--jf-border, #e2e8f0);
        overflow-y: auto;
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
        overflow-y: auto;
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
  private readonly activeSpaceService = inject(ActiveSpaceService);
  private readonly router = inject(Router);
  private readonly breakpoints = inject(BreakpointObserver);

  protected readonly initialOf = initialOf;

  protected readonly isDesktop = toSignal(
    this.breakpoints.observe(DESKTOP_QUERY).pipe(map((s) => s.matches)),
    { initialValue: false },
  );

  private readonly _drawerOpen = signal(false);
  protected readonly drawerOpen = this._drawerOpen.asReadonly();

  protected readonly activeSpace = this.activeSpaceService.activeSpace;

  protected readonly avatarUrl = computed(() => this.auth.context()?.profile?.avatarUrl ?? null);
  protected readonly userInitial = computed(() => {
    const profile = this.auth.context()?.profile;
    return initialOf(profile?.fullName || profile?.email || '?');
  });
  /** Nome do usuário; sem nome cadastrado, mostra as iniciais em vez do e-mail. */
  protected readonly userDisplayName = computed(() => {
    const profile = this.auth.context()?.profile;
    return profile?.fullName?.trim() || this.userInitial();
  });

  protected readonly userMenuItems: MenuItem[] = [
    { label: 'Meu perfil', icon: 'pi pi-user', routerLink: '/perfil' },
    { separator: true },
    { label: 'Sair', icon: 'pi pi-sign-out', command: () => void this.signOut() },
  ];

  protected toggleDrawer(): void {
    this._drawerOpen.update((v) => !v);
  }
  protected closeDrawer(): void {
    this._drawerOpen.set(false);
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigate(['/login']);
  }
}
