import { ChangeDetectionStrategy, Component, Input, booleanAttribute } from '@angular/core';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'jf-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      [type]="type"
      [disabled]="disabled || loading"
      [attr.aria-busy]="loading || null"
      class="btn"
      [class.btn--primary]="variant === 'primary'"
      [class.btn--secondary]="variant === 'secondary'"
      [class.btn--ghost]="variant === 'ghost'"
      [class.btn--danger]="variant === 'danger'"
      [class.btn--sm]="size === 'sm'"
      [class.btn--lg]="size === 'lg'"
      [class.btn--block]="block"
    >
      @if (loading) {
        <span class="btn__spinner" aria-hidden="true"></span>
      }
      <ng-content />
    </button>
  `,
  styles: [
    `
      :host {
        display: inline-block;
      }
      :host(.block),
      .btn--block {
        width: 100%;
      }
      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        font: inherit;
        font-weight: 600;
        border-radius: var(--jf-radius, 8px);
        border: 1px solid transparent;
        padding: 0.5rem 1rem;
        cursor: pointer;
        transition:
          background-color 0.15s,
          border-color 0.15s,
          opacity 0.15s;
      }
      .btn:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .btn--sm {
        padding: 0.3rem 0.7rem;
        font-size: 0.8125rem;
      }
      .btn--lg {
        padding: 0.7rem 1.4rem;
        font-size: 1rem;
      }
      .btn--block {
        width: 100%;
      }
      .btn--primary {
        background: var(--jf-primary, #2563eb);
        color: #fff;
      }
      .btn--primary:hover:not(:disabled) {
        background: var(--jf-primary-strong, #1d4ed8);
      }
      .btn--secondary {
        background: var(--jf-surface, #fff);
        border-color: var(--jf-border, #cbd5e1);
        color: var(--jf-text, #0f172a);
      }
      .btn--secondary:hover:not(:disabled) {
        background: var(--jf-surface-muted, #f1f5f9);
      }
      .btn--ghost {
        background: transparent;
        color: var(--jf-text, #0f172a);
      }
      .btn--ghost:hover:not(:disabled) {
        background: var(--jf-surface-muted, #f1f5f9);
      }
      .btn--danger {
        background: var(--jf-danger, #dc2626);
        color: #fff;
      }
      .btn__spinner {
        width: 0.9em;
        height: 0.9em;
        border: 2px solid currentColor;
        border-right-color: transparent;
        border-radius: 50%;
        animation: jf-btn-spin 0.7s linear infinite;
      }
      @keyframes jf-btn-spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class ButtonComponent {
  @Input() variant: ButtonVariant = 'primary';
  @Input() size: ButtonSize = 'md';
  @Input() type: 'button' | 'submit' | 'reset' = 'button';
  @Input({ transform: booleanAttribute }) disabled = false;
  @Input({ transform: booleanAttribute }) loading = false;
  @Input({ transform: booleanAttribute }) block = false;
}
