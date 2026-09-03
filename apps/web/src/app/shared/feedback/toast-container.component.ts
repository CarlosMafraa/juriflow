import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from './toast.service';

@Component({
  selector: 'jf-toast-container',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toast-stack" role="region" aria-label="Notificações" aria-live="polite">
      @for (toast of toasts.toasts(); track toast.id) {
        <div class="toast toast--{{ toast.kind }}">
          <span class="toast__msg">{{ toast.message }}</span>
          <button
            type="button"
            class="toast__close"
            aria-label="Fechar notificação"
            (click)="toasts.dismiss(toast.id)"
          >
            &times;
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .toast-stack {
        position: fixed;
        z-index: 1000;
        right: 1rem;
        bottom: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        max-width: min(92vw, 24rem);
      }
      .toast {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        border-radius: var(--jf-radius, 8px);
        background: var(--jf-surface, #fff);
        border-left: 4px solid var(--jf-border, #cbd5e1);
        box-shadow: 0 6px 20px rgb(15 23 42 / 12%);
        font-size: 0.875rem;
      }
      .toast--success {
        border-left-color: var(--jf-success, #16a34a);
      }
      .toast--error {
        border-left-color: var(--jf-danger, #dc2626);
      }
      .toast--warning {
        border-left-color: var(--jf-warning, #d97706);
      }
      .toast--info {
        border-left-color: var(--jf-primary, #2563eb);
      }
      .toast__msg {
        flex: 1;
      }
      .toast__close {
        border: 0;
        background: transparent;
        font-size: 1.1rem;
        line-height: 1;
        cursor: pointer;
        color: var(--jf-text-muted, #64748b);
      }
    `,
  ],
})
export class ToastContainerComponent {
  protected readonly toasts = inject(ToastService);
}
