import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: 'jf-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card">
      @if (title) {
        <header class="card__header">
          <h3 class="card__title">{{ title }}</h3>
          <div class="card__actions"><ng-content select="[card-actions]" /></div>
        </header>
      }
      <div class="card__body"><ng-content /></div>
      <ng-content select="[card-footer]" />
    </section>
  `,
  styles: [
    `
      .card {
        background: var(--jf-surface, #fff);
        border: 1px solid var(--jf-border, #e2e8f0);
        border-radius: var(--jf-radius-lg, 12px);
        overflow: hidden;
      }
      .card__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 1rem 1.25rem;
        border-bottom: 1px solid var(--jf-border, #e2e8f0);
      }
      .card__title {
        margin: 0;
        font-size: 0.95rem;
        font-weight: 700;
      }
      .card__body {
        padding: 1.25rem;
      }
    `,
  ],
})
export class CardComponent {
  @Input() title = '';
}
