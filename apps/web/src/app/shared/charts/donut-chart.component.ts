import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ChartModule } from 'primeng/chart';
import { chartFont, cssColor } from './chart-theme';

export interface DonutSegment {
  /** Identidade estável: a cor segue a categoria, nunca a posição. */
  key: string;
  label: string;
  value: number;
  /** Token CSS da cor (ex.: 'var(--jf-viz-1)'). */
  color: string;
}

/**
 * Rosca de parte-do-todo (<= 6 fatias), com o `p-chart` do PrimeNG (Chart.js).
 * O valor de cada fatia fica escrito na legenda ao lado — a tooltip do gráfico
 * só complementa, e o canvas não é o único jeito de ler o número.
 */
@Component({
  selector: 'jf-donut-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChartModule],
  template: `
    <div class="donut">
      <div class="donut__plot">
        <p-chart
          type="doughnut"
          [data]="data()"
          [options]="options()"
          [responsive]="false"
          width="168px"
          height="168px"
          [ariaLabel]="ariaLabel() + ': ' + summary()"
        />
        <div class="donut__center" aria-hidden="true">
          <strong>{{ total() }}</strong>
          <span>{{ centerLabel() }}</span>
        </div>
      </div>

      <ul class="donut__legend">
        @for (s of segments(); track s.key) {
          <li>
            <span class="swatch" [style.background]="s.color" aria-hidden="true"></span>
            <span class="donut__label">{{ s.label }}</span>
            <strong class="donut__value">{{ s.value }}</strong>
            <span class="donut__pct">{{ percentOf(s.value) }}%</span>
          </li>
        }
      </ul>
    </div>
  `,
  styles: [
    `
      .donut {
        display: flex;
        align-items: center;
        gap: 1.25rem;
        flex-wrap: wrap;
      }
      .donut__plot {
        position: relative;
        flex: none;
        width: 168px;
        height: 168px;
      }
      .donut__center {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        pointer-events: none;
      }
      .donut__center strong {
        font-size: 1.6rem;
        font-weight: 700;
        line-height: 1.1;
        color: var(--jf-text, #0f172a);
      }
      .donut__center span {
        font-size: 0.72rem;
        color: var(--jf-text-muted, #64748b);
      }
      .donut__legend {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.55rem;
        flex: 1 1 10rem;
        min-width: 0;
      }
      .donut__legend li {
        display: grid;
        grid-template-columns: 0.75rem 1fr auto 2.75rem;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
        color: var(--jf-text, #0f172a);
      }
      .swatch {
        width: 0.75rem;
        height: 0.75rem;
        border-radius: 3px;
      }
      .donut__label {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .donut__value {
        font-variant-numeric: tabular-nums;
        text-align: right;
      }
      .donut__pct {
        font-variant-numeric: tabular-nums;
        text-align: right;
        font-size: 0.78rem;
        color: var(--jf-text-muted, #64748b);
      }
    `,
  ],
})
export class DonutChartComponent {
  readonly segments = input.required<DonutSegment[]>();
  readonly centerLabel = input('total');
  readonly ariaLabel = input('Gráfico de rosca');

  protected readonly total = computed(() =>
    this.segments().reduce((sum, s) => sum + Math.max(0, s.value), 0),
  );

  protected readonly summary = computed(() =>
    this.segments()
      .map((s) => `${s.label} ${s.value}`)
      .join(', '),
  );

  protected readonly data = computed(() => {
    const segments = this.segments();
    if (this.total() === 0) {
      // Sem dados: anel cinza vazio, sem tooltip.
      return {
        labels: ['Sem dados'],
        datasets: [
          { data: [1], backgroundColor: [cssColor('var(--jf-viz-grid)')], borderWidth: 0 },
        ],
      };
    }
    return {
      labels: segments.map((s) => s.label),
      datasets: [
        {
          data: segments.map((s) => s.value),
          backgroundColor: segments.map((s) => cssColor(s.color)),
          // 2px da cor do fundo entre fatias: separa sem desenhar borda.
          borderColor: cssColor('var(--jf-surface)') || '#ffffff',
          borderWidth: 2,
          hoverOffset: 4,
        },
      ],
    };
  });

  protected readonly options = computed(() => {
    const empty = this.total() === 0;
    return {
      cutout: '74%',
      animation: { duration: 300 },
      layout: { padding: 4 },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: !empty,
          titleFont: chartFont(12),
          bodyFont: chartFont(12),
          callbacks: {
            label: (ctx: { label: string; parsed: number }) =>
              ` ${ctx.label}: ${ctx.parsed} (${this.percentOf(ctx.parsed)}%)`,
          },
        },
      },
    };
  });

  protected percentOf(value: number): number {
    const total = this.total();
    return total === 0 ? 0 : Math.round((value / total) * 100);
  }
}
