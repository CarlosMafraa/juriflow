import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

type AlertTone = 'info' | 'success' | 'warning' | 'danger';

@Component({
  selector: 'jf-alert',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="alert alert--{{ tone }}" role="alert">
      @if (title) {
        <p class="alert__title">{{ title }}</p>
      }
      <div class="alert__body"><ng-content /></div>
    </div>
  `,
  styles: [
    `
      .alert {
        border: 1px solid;
        border-radius: var(--jf-radius, 8px);
        padding: 0.75rem 1rem;
        font-size: 0.875rem;
      }
      .alert__title {
        margin: 0 0 0.25rem;
        font-weight: 700;
      }
      .alert--info {
        background: #eff6ff;
        border-color: #bfdbfe;
        color: #1e40af;
      }
      .alert--success {
        background: #f0fdf4;
        border-color: #bbf7d0;
        color: #166534;
      }
      .alert--warning {
        background: #fffbeb;
        border-color: #fde68a;
        color: #92400e;
      }
      .alert--danger {
        background: #fef2f2;
        border-color: #fecaca;
        color: #991b1b;
      }
    `,
  ],
})
export class AlertComponent {
  @Input() tone: AlertTone = 'info';
  @Input() title = '';
}
