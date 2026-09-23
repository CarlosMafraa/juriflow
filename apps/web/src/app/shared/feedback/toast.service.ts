import { Injectable, inject } from '@angular/core';
import { MessageService } from 'primeng/api';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

const DEFAULT_TIMEOUT = 5000;

const SEVERITY: Record<ToastKind, 'success' | 'error' | 'info' | 'warn'> = {
  success: 'success',
  error: 'error',
  info: 'info',
  warning: 'warn',
};

const SUMMARY: Record<ToastKind, string> = {
  success: 'Sucesso',
  error: 'Erro',
  info: 'Aviso',
  warning: 'Atenção',
};

/** Camada fina sobre o MessageService/`<p-toast>` do PrimeNG. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly messages = inject(MessageService);

  success(message: string, timeout = DEFAULT_TIMEOUT): void {
    this.push('success', message, timeout);
  }
  error(message: string, timeout = DEFAULT_TIMEOUT): void {
    this.push('error', message, timeout);
  }
  info(message: string, timeout = DEFAULT_TIMEOUT): void {
    this.push('info', message, timeout);
  }
  warning(message: string, timeout = DEFAULT_TIMEOUT): void {
    this.push('warning', message, timeout);
  }

  private push(kind: ToastKind, message: string, timeout: number): void {
    this.messages.add({
      severity: SEVERITY[kind],
      summary: SUMMARY[kind],
      detail: message,
      life: timeout,
    });
  }
}
