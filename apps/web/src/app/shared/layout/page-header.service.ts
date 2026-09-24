import { Injectable, TemplateRef, signal } from '@angular/core';

/**
 * Ponte entre cada tela e a topbar (AuthLayoutComponent): a tela define
 * título/subtítulo e, opcionalmente, um botão de ação via
 * `PageHeaderActionsDirective` — a topbar só lê os signals, nunca sabe qual
 * tela está ativa.
 */
@Injectable({ providedIn: 'root' })
export class PageHeaderService {
  private readonly _title = signal('');
  private readonly _subtitle = signal<string | undefined>(undefined);
  private readonly _actions = signal<TemplateRef<unknown> | null>(null);

  readonly title = this._title.asReadonly();
  readonly subtitle = this._subtitle.asReadonly();
  readonly actions = this._actions.asReadonly();

  set(title: string, subtitle?: string): void {
    this._title.set(title);
    this._subtitle.set(subtitle);
  }

  setActions(tpl: TemplateRef<unknown> | null): void {
    this._actions.set(tpl);
  }
}
