import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

export interface DonutSegment {
  /** Identidade estável: a cor segue a categoria, nunca a posição. */
  key: string;
  label: string;
  value: number;
  /** Token CSS da cor (ex.: 'var(--jf-viz-1)'). */
  color: string;
}

interface Arc extends DonutSegment {
  path: string;
  percent: number;
}

const SIZE = 168;
const OUTER = 76;
const INNER = 56;
/** 2px de fundo entre fatias (o "respiro" que separa, em vez de borda). */
const GAP_PX = 2;

/**
 * Rosca de parte-do-todo (<= 6 fatias). O valor de cada fatia fica escrito na
 * legenda — a tooltip só complementa, nunca é o único jeito de ler o número.
 */
@Component({
  selector: 'jf-donut-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="donut">
      <div class="donut__plot">
        <svg
          [attr.viewBox]="'0 0 ' + size + ' ' + size"
          [attr.width]="size"
          [attr.height]="size"
          role="img"
          [attr.aria-label]="ariaLabel()"
        >
          @if (total() === 0) {
            <circle
              [attr.cx]="size / 2"
              [attr.cy]="size / 2"
              [attr.r]="(outer + inner) / 2"
              fill="none"
              stroke="var(--jf-viz-grid)"
              [attr.stroke-width]="outer - inner"
            />
          }
          @for (a of arcs(); track a.key) {
            <path
              class="donut__arc"
              [class.donut__arc--active]="active() === a.key"
              [class.donut__arc--dim]="active() !== null && active() !== a.key"
              [attr.d]="a.path"
              [attr.fill]="a.color"
              tabindex="0"
              [attr.aria-label]="a.label + ': ' + a.value + ' (' + a.percent + '%)'"
              (pointerenter)="active.set(a.key)"
              (pointerleave)="active.set(null)"
              (focus)="active.set(a.key)"
              (blur)="active.set(null)"
            />
          }
        </svg>
        <div class="donut__center" aria-hidden="true">
          @if (activeArc(); as a) {
            <strong>{{ a.value }}</strong>
            <span>{{ a.label }} · {{ a.percent }}%</span>
          } @else {
            <strong>{{ total() }}</strong>
            <span>{{ centerLabel() }}</span>
          }
        </div>
      </div>

      <ul class="donut__legend">
        @for (s of segments(); track s.key) {
          <li
            [class.donut__legend--active]="active() === s.key"
            (pointerenter)="active.set(s.key)"
            (pointerleave)="active.set(null)"
          >
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
      }
      .donut__arc {
        cursor: default;
        outline: none;
        transition: opacity 120ms ease;
      }
      .donut__arc--dim {
        opacity: 0.35;
      }
      .donut__arc:focus-visible {
        stroke: var(--jf-text, #0f172a);
        stroke-width: 2px;
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
        padding: 0 2.5rem;
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
      .donut__legend--active .donut__label {
        font-weight: 600;
      }
    `,
  ],
})
export class DonutChartComponent {
  readonly segments = input.required<DonutSegment[]>();
  readonly centerLabel = input('total');
  readonly ariaLabel = input('Gráfico de rosca');

  protected readonly size = SIZE;
  protected readonly outer = OUTER;
  protected readonly inner = INNER;
  protected readonly active = signal<string | null>(null);

  protected readonly total = computed(() =>
    this.segments().reduce((sum, s) => sum + Math.max(0, s.value), 0),
  );

  protected readonly arcs = computed<Arc[]>(() => {
    const total = this.total();
    if (total === 0) return [];
    const visible = this.segments().filter((s) => s.value > 0);
    const c = SIZE / 2;
    // Com uma fatia só, sem vão (senão sobra um corte no anel).
    const gap = visible.length > 1 ? GAP_PX / OUTER : 0;
    let start = -Math.PI / 2;
    return visible.map((s) => {
      const sweep = (s.value / total) * Math.PI * 2;
      const a0 = start + gap / 2;
      const a1 = start + sweep - gap / 2;
      start += sweep;
      return {
        ...s,
        path: ringPath(c, a0, Math.max(a0 + 0.0001, a1)),
        percent: this.percentOf(s.value),
      };
    });
  });

  protected readonly activeArc = computed(
    () => this.arcs().find((a) => a.key === this.active()) ?? null,
  );

  protected percentOf(value: number): number {
    const total = this.total();
    return total === 0 ? 0 : Math.round((value / total) * 100);
  }
}

function ringPath(c: number, a0: number, a1: number): string {
  // Fatia inteira (100%): dois semicírculos, porque um arco de 360° não desenha.
  if (a1 - a0 >= Math.PI * 2 - 0.001) {
    const mid = a0 + Math.PI;
    return `${ringPath(c, a0, mid)} ${ringPath(c, mid, a0 + Math.PI * 2 - 0.0001)}`;
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (r: number, a: number) =>
    `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`;
  return [
    `M ${p(OUTER, a0)}`,
    `A ${OUTER} ${OUTER} 0 ${large} 1 ${p(OUTER, a1)}`,
    `L ${p(INNER, a1)}`,
    `A ${INNER} ${INNER} 0 ${large} 0 ${p(INNER, a0)}`,
    'Z',
  ].join(' ');
}
