import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const DEFAULT_TIMEOUT = 5000;

/** Sistema básico de notificações (toasts). */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private seq = 0;
  private readonly _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

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

  dismiss(id: number): void {
    this._toasts.update((list) => list.filter((t) => t.id !== id));
  }

  clear(): void {
    this._toasts.set([]);
  }

  private push(kind: ToastKind, message: string, timeout: number): void {
    const id = ++this.seq;
    this._toasts.update((list) => [...list, { id, kind, message }]);
    if (timeout > 0 && typeof setTimeout !== 'undefined') {
      setTimeout(() => this.dismiss(id), timeout);
    }
  }
}
