import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';

/**
 * Página genérica "em construção" para rotas que já existem (com guard) mas cujo
 * módulo entra numa fase futura. Título e fase vêm de `route.data`.
 */
@Component({
  selector: 'jf-placeholder',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CardModule],
  template: `
    <header class="page-head">
      <h1>{{ title }}</h1>
    </header>
    <p-card>
      <div class="content">
        <i class="pi pi-wrench" aria-hidden="true"></i>
        <h2>{{ title }} — em construção</h2>
        <p>{{ message }}</p>
      </div>
    </p-card>
  `,
  styles: [
    `
      .page-head h1 {
        margin: 0 0 1rem;
        font-size: 1.35rem;
      }
      .content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        text-align: center;
        padding: 1.5rem 1rem;
      }
      .content i {
        font-size: 2rem;
        color: var(--jf-text-muted, #64748b);
      }
      .content h2 {
        margin: 0.25rem 0;
        font-size: 1.05rem;
      }
      .content p {
        margin: 0;
        color: var(--jf-text-muted, #64748b);
        font-size: 0.9rem;
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
