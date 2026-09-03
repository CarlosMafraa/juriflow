import { ChangeDetectionStrategy, Component, Inject } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ButtonComponent } from './button.component';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
}

@Component({
  selector: 'jf-confirm-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent],
  template: `
    <div class="dialog" role="alertdialog" aria-modal="true" [attr.aria-label]="data.title">
      <h2 class="dialog__title">{{ data.title }}</h2>
      <p class="dialog__message">{{ data.message }}</p>
      <div class="dialog__actions">
        <jf-button variant="secondary" (click)="ref.close(false)">
          {{ data.cancelLabel || 'Cancelar' }}
        </jf-button>
        <jf-button
          [variant]="data.tone === 'danger' ? 'danger' : 'primary'"
          (click)="ref.close(true)"
        >
          {{ data.confirmLabel || 'Confirmar' }}
        </jf-button>
      </div>
    </div>
  `,
  styles: [
    `
      .dialog {
        background: var(--jf-surface, #fff);
        border-radius: var(--jf-radius-lg, 12px);
        padding: 1.5rem;
        width: min(92vw, 26rem);
        box-shadow: 0 24px 60px rgb(15 23 42 / 25%);
      }
      .dialog__title {
        margin: 0 0 0.5rem;
        font-size: 1.05rem;
      }
      .dialog__message {
        margin: 0 0 1.25rem;
        color: var(--jf-text-muted, #475569);
        font-size: 0.9rem;
      }
      .dialog__actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
      }
    `,
  ],
})
export class ConfirmDialogComponent {
  constructor(
    public readonly ref: DialogRef<boolean>,
    @Inject(DIALOG_DATA) public readonly data: ConfirmDialogData,
  ) {}
}
