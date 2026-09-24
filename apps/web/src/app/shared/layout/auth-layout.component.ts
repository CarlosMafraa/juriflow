import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { map } from 'rxjs';
import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { AuthService } from '../../core/auth/auth.service';
import { PageHeaderService } from './page-header.service';
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
  imports: [RouterOutlet, RouterLink, SidebarComponent, ButtonModule, AvatarModule, NgTemplateOutlet],
  template: `
    <div class="layout">
      <!-- Menu: coluna própria, altura cheia da tela — não fica "embaixo" de
           uma topbar que atravessa a largura toda (bug reportado: o menu
           não batia no teto da página). -->
      @if (isDesktop()) {
        <aside class="drawer">
          <jf-sidebar />
        </aside>
      }
      @if (!isDesktop() && drawerOpen()) {
        <aside class="drawer drawer--overlay">
          <jf-sidebar (navigate)="closeDrawer()" />
        </aside>
        <div class="scrim" (click)="closeDrawer()" aria-hidden="true"></div>
      }

      <div class="right-col">
        <header class="topbar">
          @if (!isDesktop()) {
            <p-button
              styleClass="topbar__hamburger"
              icon="pi pi-bars"
              [text]="true"
              severity="secondary"
              [attr.aria-expanded]="drawerOpen()"
              ariaLabel="Alternar menu"
              (onClick)="toggleDrawer()"
            />
          }

          <!-- Título/subtítulo da tela — cada tela define via PageHeaderService. -->
          <div class="topbar__titles">
            <h1>{{ pageHeader.title() }}</h1>
            @if (pageHeader.subtitle(); as sub) {
              <p>{{ sub }}</p>
            }
          </div>

          <div class="topbar__spacer"></div>

          <!-- flex-shrink:0 — numa tela estreita, quem cede espaço é o título
               (com ellipsis), nunca o texto destes botões (que quebraria
               linha). -->
          <div class="topbar__actions">
            <a class="user-link" routerLink="/perfil" aria-label="Meu perfil">
              @if (avatarUrl()) {
                <p-avatar [image]="avatarUrl()!" shape="circle" size="normal" />
              } @else {
                <p-avatar [label]="userInitial()" shape="circle" size="normal" />
              }
              <span class="user-link__name">{{ userDisplayName() }}</span>
            </a>

            <p-button
              label="Sair"
              icon="pi pi-sign-out"
              size="small"
              [outlined]="true"
              [loading]="signingOut()"
              (onClick)="signOut()"
            />
          </div>
        </header>

        <main class="main" id="main-content">
          <!-- Ação da tela — cada tela define via <ng-template jfPageHeaderActions>.
               Fica no conteúdo, não na topbar (ficava esquisito na mesma
               linha do avatar do usuário). -->
          @if (pageHeader.actions(); as actionsTpl) {
            <div class="main__actions">
              <ng-container [ngTemplateOutlet]="actionsTpl" />
            </div>
          }
          <router-outlet />
        </main>
      </div>
    </div>
  `,
  styles: [
    `
      .layout {
        display: flex;
        flex-direction: row;
        height: 100vh;
        background: var(--jf-bg, #f8fafc);
      }
      .right-col {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
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
      .topbar__titles {
        min-width: 0;
      }
      .topbar__titles h1 {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 600;
        color: var(--jf-text, #0f172a);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .topbar__titles p {
        margin: 0;
        font-size: 0.8rem;
        color: var(--jf-text-muted, #64748b);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .topbar__spacer {
        flex: 1;
      }
      .topbar__actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-shrink: 0;
        white-space: nowrap;
      }
      :host ::ng-deep .topbar__hamburger {
        flex-shrink: 0;
      }
      .user-link {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        color: var(--jf-text, #0f172a);
        text-decoration: none;
        font-size: 0.85rem;
        padding: 0.25rem 0.4rem;
        border-radius: var(--jf-radius, 8px);
      }
      .user-link:hover {
        background: var(--jf-surface-muted, #f1f5f9);
      }
      .user-link__name {
        max-width: 8rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      @media (max-width: 640px) {
        /* Tela estreita já disputa espaço com o botão de ação da página —
           mantém só o avatar, o nome esconde. */
        .user-link__name {
          display: none;
        }
      }
      @media (max-width: 480px) {
        /* Hamburguer + botão de ação da página + avatar + Sair já enchem uma
           tela de celular pequena — sem isso o título fica sem espaço nenhum
           e some por completo. Esconder o rótulo dos botões quebraria leitor
           de tela (o texto oculto some do nome acessível também), então quem
           cede aqui é o avatar — Meu perfil continua alcançável em telas
           maiores ou pela barra de endereço. */
        .user-link {
          display: none;
        }
      }
      :host ::ng-deep .user-link .p-avatar {
        background: var(--jf-primary, #1f385d);
        color: #fff;
        font-weight: 600;
        font-size: 0.8rem;
      }
      .drawer {
        flex: none;
        width: 15rem;
        overflow-y: auto;
      }
      .drawer--overlay {
        position: fixed;
        top: 0;
        bottom: 0;
        left: 0;
        z-index: 30;
        box-shadow: 0 12px 40px rgb(15 23 42 / 20%);
      }
      .scrim {
        position: fixed;
        inset: 0;
        background: rgb(15 23 42 / 35%);
        z-index: 25;
      }
      .main {
        flex: 1;
        /* Sem isso o item cresce pelo conteúdo em vez de respeitar a altura
           do pai — aí quem rola é a página inteira, não só o main.
           Sem max-width/margin:auto — isso capava a página numa largura fixa
           e sobrava vão vazio dos dois lados em monitor largo, mesmo depois
           de cada tela já preencher 100% do que achava ser o espaço todo. */
        min-height: 0;
        padding: 1.25rem;
        width: 100%;
        overflow-y: auto;
      }
      .main__actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
        margin-bottom: 1rem;
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
  private readonly router = inject(Router);
  private readonly breakpoints = inject(BreakpointObserver);
  protected readonly pageHeader = inject(PageHeaderService);

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

  protected readonly isDesktop = toSignal(
    this.breakpoints.observe(DESKTOP_QUERY).pipe(map((s) => s.matches)),
    { initialValue: false },
  );

  private readonly _drawerOpen = signal(false);
  protected readonly drawerOpen = this._drawerOpen.asReadonly();

  protected readonly signingOut = signal(false);

  protected toggleDrawer(): void {
    this._drawerOpen.update((v) => !v);
  }
  protected closeDrawer(): void {
    this._drawerOpen.set(false);
  }

  protected async signOut(): Promise<void> {
    this.signingOut.set(true);
    try {
      await this.auth.signOut();
      await this.router.navigate(['/login']);
    } finally {
      this.signingOut.set(false);
    }
  }
}
