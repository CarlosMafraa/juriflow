import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ProgressBarModule } from 'primeng/progressbar';

type Level = 'ok' | 'warning' | 'critical';

/**
 * Medidor de uma razão contra um limite ("3 de 5"), com o `p-progressbar` do
 * PrimeNG. Trilha num tom mais claro da mesma cor; em modo limite, a cor vira
 * estado (perto/estourado) e sempre vem acompanhada de ícone + texto.
 */
@Component({
  selector: 'jf-meter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProgressBarModule],
  template: `
    <div class="meter">
      <div class="meter__head">
        <span class="meter__label">{{ label() }}</span>
        <span class="meter__value">
          <strong>{{ value() }}</strong> de {{ max() }}
        </span>
      </div>
      <div
        class="meter__track"
        role="meter"
        [attr.aria-label]="label()"
        [attr.aria-valuenow]="value()"
        aria-valuemin="0"
        [attr.aria-valuemax]="max()"
        [attr.aria-valuetext]="value() + ' de ' + max()"
      >
        <!-- O papel "meter" (com os números) fica no contêiner; a barra é só visual. -->
        <p-progressbar
          aria-hidden="true"
          [value]="fillPercent()"
          [showValue]="false"
          [color]="fillColor()"
          styleClass="meter__bar"
        />
      </div>
      <div class="meter__foot">
        @if (level() === 'critical') {
          <span class="meter__state meter__state--critical">
            <i class="pi pi-ban" aria-hidden="true"></i>
            {{ value() > max() ? 'Acima do limite do plano' : 'Limite atingido' }}
          </span>
        } @else if (level() === 'warning') {
          <span class="meter__state meter__state--warning">
            <i class="pi pi-exclamation-triangle" aria-hidden="true"></i> Perto do limite
          </span>
        } @else if (hint()) {
          <span class="meter__hint">{{ hint() }}</span>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .meter {
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
      }
      .meter__head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 0.75rem;
        font-size: 0.875rem;
        color: var(--jf-text, #0f172a);
      }
      .meter__label {
        font-weight: 600;
      }
      .meter__value {
        color: var(--jf-text-muted, #64748b);
        white-space: nowrap;
      }
      .meter__value strong {
        font-size: 1.05rem;
        color: var(--jf-text, #0f172a);
      }
      :host ::ng-deep .meter__bar {
        height: 10px;
        border-radius: 4px;
        background: var(--jf-viz-track);
      }
      :host ::ng-deep .meter__bar .p-progressbar-value {
        border-radius: 4px;
      }
      .meter__foot {
        min-height: 1.1rem;
        font-size: 0.78rem;
      }
      .meter__hint {
        color: var(--jf-text-muted, #64748b);
      }
      .meter__state {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        font-weight: 600;
        color: var(--jf-warning-text, #92400e);
      }
      .meter__state--critical {
        color: #b42318;
      }
    `,
  ],
})
export class MeterComponent {
  readonly label = input.required<string>();
  readonly value = input.required<number>();
  readonly max = input.required<number>();
  readonly hint = input('');
  /** Limite de plano (cor de estado perto/estourado) ou só cobertura (cor única). */
  readonly limit = input(true);

  protected readonly fillPercent = computed(() => {
    const max = this.max();
    if (max <= 0) return this.value() > 0 ? 100 : 0;
    return Math.min(100, (this.value() / max) * 100);
  });

  protected readonly fillColor = computed(() =>
    this.level() === 'critical'
      ? 'var(--jf-viz-critical)'
      : this.level() === 'warning'
        ? 'var(--jf-viz-warning)'
        : 'var(--jf-viz-1)',
  );

  protected readonly level = computed<Level>(() => {
    if (!this.limit()) return 'ok';
    const max = this.max();
    const value = this.value();
    if (max <= 0 || value >= max) return value > 0 || max <= 0 ? 'critical' : 'ok';
    return value / max >= 0.8 ? 'warning' : 'ok';
  });
}
