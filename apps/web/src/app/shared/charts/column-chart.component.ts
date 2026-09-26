import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { ChartModule } from 'primeng/chart';
import { chartFont, cssColor } from './chart-theme';

export interface ColumnPoint {
  /** Rótulo curto do eixo (ex.: "25/09", "set/26"). */
  label: string;
  /** Rótulo completo da tooltip/tabela (ex.: "25/09/2026"). */
  title: string;
  value: number;
}

/**
 * Colunas de uma série só ao longo do tempo, com o `p-chart` do PrimeNG
 * (Chart.js). Uma cor (slot 1), topo arredondado e base reta, colunas finas,
 * grade discreta. "Ver tabela" mostra os mesmos números sem depender da
 * tooltip do canvas (leitor de tela e teclado).
 */
@Component({
  selector: 'jf-column-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChartModule],
  template: `
    @if (showTable()) {
      <table class="col__table">
        <caption class="sr-only">
          {{
            ariaLabel()
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ periodHeader() }}</th>
            <th scope="col" class="num">{{ valueHeader() }}</th>
          </tr>
        </thead>
        <tbody>
          @for (p of points(); track p.title) {
            <tr>
              <td>{{ p.title }}</td>
              <td class="num">{{ p.value }}</td>
            </tr>
          }
        </tbody>
      </table>
    } @else {
      <p-chart
        type="bar"
        [data]="data()"
        [options]="options()"
        height="180px"
        [ariaLabel]="ariaLabel()"
      />
    }
    <button type="button" class="col__toggle" (click)="showTable.set(!showTable())">
      {{ showTable() ? 'Ver gráfico' : 'Ver tabela' }}
    </button>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .col__toggle {
        margin-top: 0.4rem;
        background: none;
        border: 0;
        padding: 0;
        font: inherit;
        font-size: 0.78rem;
        color: var(--jf-primary, #1f385d);
        cursor: pointer;
        text-decoration: underline;
      }
      .col__table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.85rem;
      }
      .col__table th,
      .col__table td {
        text-align: left;
        padding: 0.3rem 0.4rem;
        border-bottom: 1px solid var(--jf-border, #e2e8f0);
      }
      .col__table .num {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
    `,
  ],
})
export class ColumnChartComponent {
  readonly points = input.required<ColumnPoint[]>();
  readonly ariaLabel = input('Gráfico de colunas');
  readonly periodHeader = input('Período');
  readonly valueHeader = input('Total');
  /** Mantido por compatibilidade: o Chart.js já espaça os rótulos do eixo sozinho. */
  readonly labelEvery = input(1);

  protected readonly showTable = signal(false);

  protected readonly data = computed(() => ({
    labels: this.points().map((p) => p.label),
    datasets: [
      {
        label: this.valueHeader(),
        data: this.points().map((p) => p.value),
        backgroundColor: cssColor('var(--jf-viz-1)'),
        hoverBackgroundColor: cssColor('var(--jf-viz-ord-4)'),
        // Topo com canto de 4px, base reta (ancorada na linha de base).
        borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 },
        borderSkipped: 'bottom',
        maxBarThickness: 24,
        categoryPercentage: 0.9,
        barPercentage: 0.9,
      },
    ],
  }));

  protected readonly options = computed(() => {
    const muted = cssColor('var(--jf-viz-muted)');
    const titles = this.points().map((p) => p.title);
    const unit = this.valueHeader().toLowerCase();
    return {
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          titleFont: chartFont(12),
          bodyFont: chartFont(12),
          callbacks: {
            title: (items: { dataIndex: number }[]) => titles[items[0]?.dataIndex ?? 0] ?? '',
            label: (ctx: { parsed: { y: number } }) => `${ctx.parsed.y} ${unit}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: cssColor('var(--jf-viz-axis)') },
          ticks: {
            color: muted,
            font: chartFont(11),
            maxRotation: 0,
            autoSkip: true,
            autoSkipPadding: 16,
          },
        },
        y: {
          beginAtZero: true,
          suggestedMax: 4,
          grid: { color: cssColor('var(--jf-viz-grid)') },
          border: { display: false },
          ticks: { color: muted, font: chartFont(11), precision: 0, maxTicksLimit: 5 },
        },
      },
    };
  });
}
