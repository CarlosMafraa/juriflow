import { Injectable, inject } from '@angular/core';
import { ConfirmationService } from 'primeng/api';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
}

/** Camada fina sobre o ConfirmationService/`<p-confirmDialog>` do PrimeNG. */
@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly confirmation = inject(ConfirmationService);

  /** Resolve `true` se confirmado, `false` se cancelado ou fechado sem escolha. */
  confirm(data: ConfirmDialogData): Promise<boolean> {
    return new Promise((resolve) => {
      this.confirmation.confirm({
        header: data.title,
        message: data.message,
        acceptLabel: data.confirmLabel || 'Confirmar',
        rejectLabel: data.cancelLabel || 'Cancelar',
        acceptButtonProps: {
          severity: data.tone === 'danger' ? 'danger' : 'primary',
          icon: data.tone === 'danger' ? 'pi pi-trash' : 'pi pi-check',
        },
        rejectButtonProps: { severity: 'secondary', outlined: true, icon: 'pi pi-times' },
        accept: () => resolve(true),
        reject: () => resolve(false),
      });
    });
  }
}
