import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

@Component({
  selector: 'jf-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge badge--{{ tone }}"><ng-content /></span>`,
  styles: [
    `
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 0.15rem 0.55rem;
        border-radius: 999px;
        font-size: 0.75rem;
        font-weight: 600;
        line-height: 1.4;
      }
      .badge--neutral {
        background: var(--jf-surface-muted, #f1f5f9);
        color: var(--jf-text-muted, #475569);
      }
      .badge--primary {
        background: #dbeafe;
        color: #1d4ed8;
      }
      .badge--success {
        background: #dcfce7;
        color: #15803d;
      }
      .badge--warning {
        background: #fef3c7;
        color: #b45309;
      }
      .badge--danger {
        background: #fee2e2;
        color: #b91c1c;
      }
    `,
  ],
})
export class BadgeComponent {
  @Input() tone: BadgeTone = 'neutral';
}
