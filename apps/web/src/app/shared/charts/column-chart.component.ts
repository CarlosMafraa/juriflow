import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';

export interface ColumnPoint {
  /** Rótulo curto do eixo (ex.: "25/09", "set/26"). */
  label: string;
  /** Rótulo completo da tooltip/tabela (ex.: "25/09/2026"). */
  title: string;
  value: number;
}

const HEIGHT = 180;
const PAD_TOP = 12;
const PAD_BOTTOM = 26;
const PAD_LEFT = 32;
const PAD_RIGHT = 8;
const MAX_BAR = 24;

/**
 * Colunas de uma série só ao longo do tempo. Uma cor (slot 1), topo com canto
 * de 4px e base reta, grade em traço fino. Passar o mouse — ou usar as setas
 * com o gráfico em foco — mostra dia e valor; "Ver tabela" dá os mesmos
 * números sem depender da tooltip.
 */
@Component({
  selector: 'jf-column-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="col">
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
        <div class="col__plot">
          <svg
            [attr.width]="width()"
            [attr.height]="height"
            role="img"
            tabindex="0"
            [attr.aria-label]="ariaLabel() + '. Use as setas para percorrer os valores.'"
            (keydown)="onKey($event)"
            (blur)="active.set(null)"
            (pointerleave)="active.set(null)"
          >
            @for (t of ticks(); track t.value) {
              <line
                [attr.x1]="padLeft"
                [attr.x2]="width() - padRight"
                [attr.y1]="t.y"
                [attr.y2]="t.y"
                [attr.stroke]="t.value === 0 ? 'var(--jf-viz-axis)' : 'var(--jf-viz-grid)'"
                stroke-width="1"
                shape-rendering="crispEdges"
              />
              <text class="col__tick" [attr.x]="padLeft - 6" [attr.y]="t.y + 4" text-anchor="end">
                {{ t.value }}
              </text>
            }
            @for (b of bars(); track b.index) {
              @if (b.path) {
                <path
                  [attr.d]="b.path"
                  fill="var(--jf-viz-1)"
                  [class.col__bar--dim]="active() !== null && active() !== b.index"
                />
              }
              @if (b.showLabel) {
                <text class="col__tick" [attr.x]="b.cx" [attr.y]="height - 8" text-anchor="middle">
                  {{ b.label }}
                </text>
              }
              <!-- Alvo do mouse: a faixa inteira, bem maior que a coluna. -->
              <rect
                [attr.x]="b.bandX"
                [attr.y]="padTop"
                [attr.width]="b.bandW"
                [attr.height]="plotHeight"
                fill="transparent"
                (pointerenter)="active.set(b.index)"
              />
            }
          </svg>
          @if (activeBar(); as b) {
            <div class="col__tip" [style.left.px]="b.cx" [style.top.px]="b.tipY" role="status">
              <strong>{{ b.value }}</strong>
              <span>{{ b.title }}</span>
            </div>
          }
        </div>
      }
      <button type="button" class="col__toggle" (click)="showTable.set(!showTable())">
        {{ showTable() ? 'Ver gráfico' : 'Ver tabela' }}
      </button>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .col__plot {
        position: relative;
        width: 100%;
      }
      svg {
        display: block;
        outline: none;
      }
      svg:focus-visible {
        outline: 2px solid var(--jf-primary, #1f385d);
        outline-offset: 2px;
        border-radius: 4px;
      }
      .col__tick {
        font-size: 11px;
        fill: var(--jf-viz-muted);
        font-variant-numeric: tabular-nums;
      }
      .col__bar--dim {
        opacity: 0.45;
      }
      .col__tip {
        position: absolute;
        transform: translate(-50%, calc(-100% - 8px));
        background: var(--jf-surface, #fff);
        border: 1px solid rgba(11, 11, 11, 0.1);
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
        padding: 0.35rem 0.55rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        pointer-events: none;
        white-space: nowrap;
        font-size: 0.75rem;
        color: var(--jf-text-muted, #64748b);
      }
      .col__tip strong {
        font-size: 0.95rem;
        color: var(--jf-text, #0f172a);
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
  /** Mostra o rótulo do eixo a cada N colunas (primeira e última sempre). */
  readonly labelEvery = input(1);

  protected readonly height = HEIGHT;
  protected readonly padTop = PAD_TOP;
  protected readonly padLeft = PAD_LEFT;
  protected readonly padRight = PAD_RIGHT;
  protected readonly plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  protected readonly width = signal(320);
  protected readonly active = signal<number | null>(null);
  protected readonly showTable = signal(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Desenha na largura real do card (mobile ou desktop), sem esticar texto.
    afterNextRender(() => {
      const el = this.host.nativeElement;
      const update = () => this.width.set(Math.max(200, Math.floor(el.clientWidth)));
      update();
      const observer = new ResizeObserver(update);
      observer.observe(el);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  /** Topo "redondo" do eixo: 1, 2, 5 × 10^n, com no máximo 4 linhas de grade. */
  private readonly niceMax = computed(() => {
    const max = Math.max(0, ...this.points().map((p) => p.value));
    if (max <= 4) return Math.max(4, max);
    const magnitude = 10 ** Math.floor(Math.log10(max));
    for (const step of [1, 2, 2.5, 5, 10]) {
      const top = Math.ceil(max / (step * magnitude)) * step * magnitude;
      if (top / (step * magnitude) <= 4) return top;
    }
    return Math.ceil(max / magnitude) * magnitude;
  });

  protected readonly ticks = computed(() => {
    const top = this.niceMax();
    const step = top / 4;
    return [0, 1, 2, 3, 4].map((i) => {
      const value = Math.round(step * i);
      return { value, y: PAD_TOP + this.plotHeight - (value / top) * this.plotHeight };
    });
  });

  protected readonly bars = computed(() => {
    const pts = this.points();
    const n = Math.max(1, pts.length);
    const plotW = this.width() - PAD_LEFT - PAD_RIGHT;
    const band = plotW / n;
    // Coluna fina (<= 24px) com 2px de respiro entre vizinhas.
    const barW = Math.max(2, Math.min(MAX_BAR, band - 2));
    const top = this.niceMax();
    const every = Math.max(1, this.labelEvery());
    return pts.map((p, index) => {
      const bandX = PAD_LEFT + index * band;
      const cx = bandX + band / 2;
      const h = top === 0 ? 0 : (p.value / top) * this.plotHeight;
      const x = cx - barW / 2;
      const yTop = PAD_TOP + this.plotHeight - h;
      return {
        index,
        label: p.label,
        title: p.title,
        value: p.value,
        cx,
        bandX,
        bandW: band,
        tipY: Math.min(yTop, PAD_TOP + this.plotHeight - 4),
        // Rótulo intermediário colado no último (ex.: 24/09 e 25/09) é pulado.
        showLabel:
          index === 0 ||
          index === n - 1 ||
          (index % every === 0 && n - 1 - index >= Math.ceil(every / 2)),
        path: h > 0 ? columnPath(x, yTop, barW, h) : '',
      };
    });
  });

  protected readonly activeBar = computed(() => {
    const i = this.active();
    return i === null ? null : (this.bars()[i] ?? null);
  });

  protected onKey(event: KeyboardEvent): void {
    const n = this.points().length;
    if (!n) return;
    const current = this.active() ?? -1;
    if (event.key === 'ArrowRight') this.active.set(Math.min(n - 1, current + 1));
    else if (event.key === 'ArrowLeft')
      this.active.set(Math.max(0, current < 0 ? n - 1 : current - 1));
    else if (event.key === 'Home') this.active.set(0);
    else if (event.key === 'End') this.active.set(n - 1);
    else return;
    event.preventDefault();
  }
}

/** Coluna com canto de 4px no topo e base reta (ancorada na linha de base). */
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return [
    `M ${x} ${y + h}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `L ${x + w - r} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + r}`,
    `L ${x + w} ${y + h}`,
    'Z',
  ].join(' ');
}
