import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CdkMenu, CdkMenuTrigger } from '@angular/cdk/menu';

/**
 * Menu suspenso acessível (CDK Menu). Uso:
 *
 *   <jf-dropdown label="Ações">
 *     <button jf-dropdown-item (click)="editar()">Editar</button>
 *     <button jf-dropdown-item (click)="remover()">Remover</button>
 *   </jf-dropdown>
 */
@Component({
  selector: 'jf-dropdown',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkMenuTrigger, CdkMenu],
  template: `
    <button type="button" class="dropdown__trigger" [cdkMenuTriggerFor]="menu">
      {{ label }}<span class="dropdown__caret" aria-hidden="true">▾</span>
    </button>
    <ng-template #menu>
      <div class="dropdown__panel" cdkMenu>
        <ng-content />
      </div>
    </ng-template>
  `,
  styles: [
    `
      .dropdown__trigger {
        font: inherit;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.45rem 0.8rem;
        border: 1px solid var(--jf-border, #cbd5e1);
        border-radius: var(--jf-radius, 8px);
        background: var(--jf-surface, #fff);
        cursor: pointer;
      }
      .dropdown__panel {
        display: flex;
        flex-direction: column;
        min-width: 10rem;
        padding: 0.35rem;
        background: var(--jf-surface, #fff);
        border: 1px solid var(--jf-border, #e2e8f0);
        border-radius: var(--jf-radius, 8px);
        box-shadow: 0 12px 32px rgb(15 23 42 / 18%);
      }
      .dropdown__panel ::ng-deep [jf-dropdown-item] {
        font: inherit;
        text-align: start;
        padding: 0.5rem 0.7rem;
        border: 0;
        background: transparent;
        border-radius: 6px;
        cursor: pointer;
      }
      .dropdown__panel ::ng-deep [jf-dropdown-item]:hover {
        background: var(--jf-surface-muted, #f1f5f9);
      }
    `,
  ],
})
export class DropdownComponent {
  @Input() label = 'Menu';
}
