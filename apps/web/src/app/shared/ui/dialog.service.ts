import { Injectable, inject } from '@angular/core';
import { Dialog, type DialogRef } from '@angular/cdk/dialog';
import { ComponentType } from '@angular/cdk/portal';
import { firstValueFrom } from 'rxjs';
import { ConfirmDialogComponent, type ConfirmDialogData } from './confirm-dialog.component';

/** Camada fina sobre o CDK Dialog. */
@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly dialog = inject(Dialog);

  open<TComponent, TData = unknown, TResult = unknown>(
    component: ComponentType<TComponent>,
    data?: TData,
  ): DialogRef<TResult, TComponent> {
    return this.dialog.open<TResult, TData, TComponent>(component, {
      data,
      hasBackdrop: true,
      autoFocus: 'first-tabbable',
      restoreFocus: true,
    });
  }

  /** Diálogo de confirmação. Resolve `true` se confirmado. */
  async confirm(data: ConfirmDialogData): Promise<boolean> {
    const ref = this.dialog.open<boolean, ConfirmDialogData>(ConfirmDialogComponent, {
      data,
      hasBackdrop: true,
      autoFocus: 'first-tabbable',
    });
    return (await firstValueFrom(ref.closed)) ?? false;
  }
}
