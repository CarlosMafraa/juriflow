import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';

/**
 * Página genérica "em construção" para rotas que já existem (com guard) mas cujo
 * módulo entra numa fase futura. Título e fase vêm de `route.data`.
 */
@Component({
  selector: 'jf-placeholder',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyStateComponent],
  template: `
    <header class="page-head">
      <h1>{{ title }}</h1>
    </header>
    <jf-empty-state [title]="title + ' — em construção'" [message]="message">
      <span empty-icon>🚧</span>
    </jf-empty-state>
  `,
  styles: [
    `
      .page-head h1 {
        margin: 0 0 1rem;
        font-size: 1.35rem;
      }
    `,
  ],
})
export class PlaceholderComponent {
  private readonly route = inject(ActivatedRoute);
  protected readonly title = (this.route.snapshot.data['title'] as string) ?? 'Módulo';
  protected readonly message =
    (this.route.snapshot.data['note'] as string) ??
    'Este módulo será implementado em uma fase futura do JuriFlow.';
}
