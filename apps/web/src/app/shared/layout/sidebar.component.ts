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
import { NAV_ITEMS, visibleNavItems } from './nav';

@Component({
  selector: 'jf-sidebar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="sidebar" aria-label="Navegação principal">
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
              <span class="sidebar__icon" aria-hidden="true">{{ item.icon }}</span>
              <span class="sidebar__label">{{ item.label }}</span>
            </a>
          </li>
        }
      </ul>
    </nav>
  `,
  styles: [
    `
      .sidebar {
        height: 100%;
        padding: 1rem 0.75rem;
        overflow-y: auto;
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
        color: var(--jf-text, #0f172a);
        text-decoration: none;
        font-size: 0.9rem;
      }
      .sidebar__link:hover {
        background: var(--jf-surface-muted, #f1f5f9);
      }
      .sidebar__link--active {
        background: var(--jf-primary, #2563eb);
        color: #fff;
      }
      .sidebar__icon {
        width: 1.25rem;
        text-align: center;
      }
    `,
  ],
})
export class SidebarComponent {
  private readonly permissions = inject(PermissionService);

  /** Permite injetar itens em testes; default = navegação real. */
  @Input() navItems = NAV_ITEMS;
  @Output() navigate = new EventEmitter<void>();

  protected readonly items = computed(() =>
    visibleNavItems((p) => this.permissions.can(p), this.navItems),
  );
}
