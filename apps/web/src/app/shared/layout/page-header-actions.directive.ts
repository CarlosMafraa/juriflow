import { Directive, OnDestroy, TemplateRef, inject } from '@angular/core';
import { PageHeaderService } from './page-header.service';

/**
 * `<ng-template jfPageHeaderActions>` numa tela registra seu conteúdo como o
 * botão de ação da topbar (ex.: "Novo processo") — some sozinho quando a
 * tela é destruída, sem cada tela precisar lembrar de limpar.
 */
@Directive({
  selector: 'ng-template[jfPageHeaderActions]',
  standalone: true,
})
export class PageHeaderActionsDirective implements OnDestroy {
  private readonly templateRef = inject(TemplateRef);
  private readonly header = inject(PageHeaderService);

  constructor() {
    this.header.setActions(this.templateRef);
  }

  ngOnDestroy(): void {
    this.header.setActions(null);
  }
}
