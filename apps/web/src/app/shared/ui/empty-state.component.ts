import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: 'jf-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="empty">
      <div class="empty__icon" aria-hidden="true"><ng-content select="[empty-icon]" /></div>
      <p class="empty__title">{{ title }}</p>
      @if (message) {
        <p class="empty__message">{{ message }}</p>
      }
      <div class="empty__action"><ng-content select="[empty-action]" /></div>
    </div>
  `,
  styles: [
    `
      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 0.5rem;
        padding: 2.5rem 1.25rem;
        color: var(--jf-text-muted, #64748b);
      }
      .empty__icon {
        font-size: 2rem;
        line-height: 1;
      }
      .empty__title {
        margin: 0;
        font-weight: 700;
        color: var(--jf-text, #0f172a);
      }
      .empty__message {
        margin: 0;
        max-width: 32rem;
        font-size: 0.875rem;
      }
      .empty__action {
        margin-top: 0.5rem;
      }
    `,
  ],
})
export class EmptyStateComponent {
  @Input() title = 'Nada por aqui ainda';
  @Input() message = '';
}
