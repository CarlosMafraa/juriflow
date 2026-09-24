import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  inject,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { PermissionService } from '../../core/authorization/permission.service';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';
import { NAV_ITEMS, visibleNavItems } from './nav';

@Component({
  selector: 'jf-sidebar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <div class="sidebar">
      <!-- Identidade do espaço: um usuário pertence a um único espaço (MVP —
           cada espaço é vendido a uma pessoa/e-mail), então é só exibição.
           Futuramente (múltiplos espaços por usuário) é aqui que entra um
           seletor de troca. -->
      <div class="sidebar__header">
        <span class="sidebar__mark"><i class="pi pi-building-columns" aria-hidden="true"></i></span>
        <div class="sidebar__brand">
          <p class="sidebar__brand-name">JuriFlow</p>
          <p class="sidebar__brand-space">{{ spaceName() }}</p>
        </div>
      </div>

      <nav aria-label="Navegação principal">
        <ul class="sidebar__list">
          @for (item of items(); track item.path) {
            <li>
              <a
                class="sidebar__link"
                [routerLink]="item.path"
                routerLinkActive="sidebar__link--active"
                [routerLinkActiveOptions]="{ exact: !!item.exact }"
                (click)="navigate.emit()"
              >
                <i class="sidebar__icon {{ item.icon }}" aria-hidden="true"></i>
                <span class="sidebar__label">{{ item.label }}</span>
              </a>
            </li>
          }
        </ul>
      </nav>
    </div>
  `,
  styles: [
    `
      /* Painel navy fixo (--jf-sidebar-*), igual no claro e no escuro — não
         segue --jf-surface/--jf-text, que trocam com o tema. */
      .sidebar {
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        padding: 1rem 0.75rem;
        overflow-y: auto;
        background: var(--jf-sidebar-bg, #152741);
      }
      .sidebar__header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.5rem 0.75rem 0;
      }
      .sidebar__mark {
        flex: none;
        display: grid;
        place-items: center;
        width: 2.25rem;
        height: 2.25rem;
        border-radius: var(--jf-radius, 8px);
        background: var(--jf-gold);
        color: var(--jf-gold-foreground);
        font-size: 1.1rem;
      }
      .sidebar__brand {
        min-width: 0;
      }
      .sidebar__brand-name {
        margin: 0;
        font-family: var(--jf-font-display);
        font-weight: 600;
        font-size: 0.9rem;
        color: var(--jf-sidebar-text-active, #eaf0f5);
      }
      .sidebar__brand-space {
        margin: 0;
        font-size: 0.75rem;
        color: var(--jf-sidebar-text, #717d90);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sidebar__list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
      }
      .sidebar__link {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.6rem 0.75rem;
        border-radius: var(--jf-radius, 8px);
        color: var(--jf-sidebar-text, #717d90);
        text-decoration: none;
        font-size: 0.9rem;
      }
      .sidebar__link:hover {
        background: rgb(255 255 255 / 6%);
        color: var(--jf-sidebar-text-active, #eaf0f5);
      }
      .sidebar__link--active,
      .sidebar__link--active:hover {
        /* :hover sozinho (classe+pseudo-classe) tem mais especificidade que
           só uma classe — sem repetir aqui, passar o mouse no item ativo
           trocava o fundo pro cinza do hover mas mantinha a letra ativa. */
        background: var(--jf-sidebar-accent, #243857);
        color: var(--jf-sidebar-text-active, #eaf0f5);
      }
      .sidebar__icon {
        width: 1.25rem;
        text-align: center;
        font-size: 1rem;
      }
    `,
  ],
})
export class SidebarComponent {
  private readonly permissions = inject(PermissionService);
  private readonly activeSpaceService = inject(ActiveSpaceService);

  /** Permite injetar itens em testes; default = navegação real. */
  @Input() navItems = NAV_ITEMS;
  @Output() navigate = new EventEmitter<void>();

  protected readonly items = computed(() =>
    visibleNavItems((p) => this.permissions.can(p), this.navItems),
  );
  protected readonly spaceName = computed(
    () => this.activeSpaceService.activeSpace()?.name ?? 'Sem espaço',
  );
}
