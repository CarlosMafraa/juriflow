import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import type { Page } from '../clients/client.service';
import {
  TrackingService,
  type CourtStrategy,
  type MovementView,
  type TrackingConfigView,
} from './tracking.service';
import {
  collectionStatusLabel,
  friendlyCollectionError,
  hasDelayWarning,
  sourceLabel,
} from './tracking-labels';
import { ToastService } from '../../shared/feedback/toast.service';
import { ButtonComponent } from '../../shared/ui/button.component';
import { CardComponent } from '../../shared/ui/card.component';
import { BadgeComponent } from '../../shared/ui/badge.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { AlertComponent } from '../../shared/ui/alert.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';

interface SourceRow {
  strategy: CourtStrategy;
  config: TrackingConfigView | null;
}

@Component({
  selector: 'jf-process-tracking-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    CardComponent,
    BadgeComponent,
    SpinnerComponent,
    AlertComponent,
    EmptyStateComponent,
  ],
  template: `
    <jf-card title="Acompanhamento">
      @if (loading()) {
        <jf-spinner [showLabel]="true" />
      } @else if (rows().length === 0) {
        <jf-empty-state
          title="Processo não acompanhado"
          message="Nenhuma fonte de acompanhamento está disponível para o tribunal deste processo. Um administrador da plataforma precisa cadastrar uma estratégia para este tribunal."
        >
          <span empty-icon>📡</span>
        </jf-empty-state>
      } @else {
        <ul class="sources">
          @for (row of rows(); track row.strategy.sourceKind) {
            <li class="source">
              <div class="source__head">
                <div>
                  <strong>{{ label(row.strategy.sourceKind) }}</strong>
                  @if (row.config?.pausedAt) {
                    <jf-badge tone="danger">auto-pausado</jf-badge>
                  } @else if (row.config?.enabled) {
                    <jf-badge tone="success">ativo</jf-badge>
                  } @else {
                    <jf-badge tone="neutral">desativado</jf-badge>
                  }
                </div>
                @if (canOperate()) {
                  <div class="source__actions">
                    <jf-button
                      size="sm"
                      variant="secondary"
                      [disabled]="busy()"
                      (click)="toggle(row)"
                    >
                      {{ row.config?.enabled && !row.config?.pausedAt ? 'Desativar' : 'Ativar' }}
                    </jf-button>
                    @if (row.config?.enabled && !row.config?.pausedAt) {
                      <jf-button size="sm" [disabled]="busy()" (click)="collectNow(row)">
                        Coletar agora
                      </jf-button>
                    }
                  </div>
                }
              </div>

              @if (delayWarning(row.strategy.sourceKind)) {
                <p class="warn">Fonte: DataJud — pode haver atraso em relação ao tribunal.</p>
              }

              @if (row.config) {
                <dl class="meta">
                  <dt>Última coleta</dt><dd>{{ row.config.lastRunAt ? fmt(row.config.lastRunAt) : 'nunca' }}</dd>
                  <dt>Situação</dt><dd>{{ statusLabel(row.config.lastRunStatus) }}</dd>
                  <dt>Próxima execução</dt><dd>{{ row.config.nextRunAt ? fmt(row.config.nextRunAt) : '—' }}</dd>
                  <dt>Falhas consecutivas</dt><dd>{{ row.config.consecutiveFailures }}</dd>
                </dl>
                @if (row.config.pausedAt) {
                  <jf-alert tone="danger">
                    Acompanhamento auto-pausado após falhas consecutivas. Reative manualmente após verificar a fonte.
                  </jf-alert>
                } @else if (errorText(row.config.lastErrorCode)) {
                  <jf-alert tone="warning">{{ errorText(row.config.lastErrorCode) }}</jf-alert>
                }
              } @else {
                <p class="muted">Ainda não configurado.</p>
              }
            </li>
          }
        </ul>

        <h3>Movimentações</h3>
        @if (movements(); as mp) {
          @if (mp.rows.length === 0) {
            <p class="muted">Nenhuma movimentação coletada ainda.</p>
          } @else {
            <ol class="timeline">
              @for (m of mp.rows; track m.id) {
                <li>
                  <span class="tl-date">{{ m.occurredAt ? fmtDate(m.occurredAt) : 's/ data' }}</span>
                  <span class="tl-body">
                    <strong>{{ m.categoryLabel || 'Movimentação' }}</strong>
                    @if (m.needsReview) { <jf-badge tone="warning">revisar</jf-badge> }
                    @if (m.isFirstSync) { <jf-badge tone="neutral">1ª sincronização</jf-badge> }
                    <span class="tl-desc">{{ m.description }}</span>
                  </span>
                </li>
              }
            </ol>
            <div class="pager">
              <jf-button size="sm" variant="ghost" [disabled]="mp.page <= 1" (click)="movPage(mp.page - 1)">Anterior</jf-button>
              <span>{{ mp.total }} movimentação(ões)</span>
              <jf-button size="sm" variant="ghost" [disabled]="mp.page * mp.pageSize >= mp.total" (click)="movPage(mp.page + 1)">Próxima</jf-button>
            </div>
          }
        }
      }
    </jf-card>
  `,
  styles: [
    `
      :host {
        display: block;
        margin-bottom: 1rem;
      }
      .sources {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .source {
        border: 1px solid var(--jf-border, #e2e8f0);
        border-radius: var(--jf-radius, 8px);
        padding: 0.85rem 1rem;
      }
      .source__head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
      }
      .source__head strong {
        margin-right: 0.5rem;
      }
      .source__actions {
        display: flex;
        gap: 0.4rem;
      }
      .warn {
        margin: 0.5rem 0 0;
        font-size: 0.8rem;
        color: var(--jf-warning, #b45309);
      }
      .meta {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 0.25rem 1rem;
        margin: 0.6rem 0 0;
        font-size: 0.83rem;
      }
      .meta dt {
        color: var(--jf-text-muted, #64748b);
      }
      .meta dd {
        margin: 0;
      }
      .muted {
        color: var(--jf-text-muted, #64748b);
      }
      h3 {
        margin: 1.5rem 0 0.5rem;
        font-size: 0.95rem;
      }
      .timeline {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
      }
      .timeline li {
        display: flex;
        gap: 0.9rem;
        border-bottom: 1px solid var(--jf-border, #eef1f5);
        padding-bottom: 0.6rem;
      }
      .tl-date {
        flex: 0 0 6rem;
        font-family: monospace;
        font-size: 0.78rem;
        color: var(--jf-text-muted, #64748b);
      }
      .tl-body {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        font-size: 0.86rem;
      }
      .tl-desc {
        color: var(--jf-text-muted, #475569);
      }
      .pager {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 1rem;
        margin-top: 0.8rem;
        font-size: 0.82rem;
        color: var(--jf-text-muted, #64748b);
      }
      @media (max-width: 767px) {
        .timeline li {
          flex-direction: column;
          gap: 0.2rem;
        }
      }
    `,
  ],
})
export class ProcessTrackingPanelComponent {
  readonly processId = input.required<string>();
  readonly courtId = input.required<string>();
  readonly canOperate = input<boolean>(false);

  private readonly service = inject(TrackingService);
  private readonly toast = inject(ToastService);

  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly rows = signal<SourceRow[]>([]);
  protected readonly movements = signal<Page<MovementView> | null>(null);

  protected readonly label = sourceLabel;
  protected readonly delayWarning = hasDelayWarning;
  protected readonly statusLabel = collectionStatusLabel;
  protected readonly errorText = friendlyCollectionError;

  constructor() {
    queueMicrotask(() => void this.load());
  }

  protected fmt(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR');
  }
  protected fmtDate(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('pt-BR');
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [strategies, configs, movPage] = await Promise.all([
        this.service.listStrategies(this.courtId()),
        this.service.getConfigs(this.processId()),
        this.service.listMovements(this.processId(), { page: 1 }),
      ]);
      const bySource = new Map(configs.map((c) => [c.sourceKind, c]));
      this.rows.set(
        strategies.map((strategy) => ({ strategy, config: bySource.get(strategy.sourceKind) ?? null })),
      );
      this.movements.set(movPage);
    } catch {
      this.toast.error('Não foi possível carregar o acompanhamento.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async toggle(row: SourceRow): Promise<void> {
    const enable = !(row.config?.enabled && !row.config?.pausedAt);
    this.busy.set(true);
    try {
      await this.service.setEnabled(this.processId(), row.strategy.sourceKind, enable);
      this.toast.success(enable ? 'Acompanhamento ativado.' : 'Acompanhamento desativado.');
      await this.load();
    } catch (err) {
      this.toast.error(this.humanize(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async collectNow(row: SourceRow): Promise<void> {
    this.busy.set(true);
    try {
      await this.service.collectNow(this.processId(), row.strategy.sourceKind);
      this.toast.success('Coleta agendada. O resultado aparece aqui após a execução.');
      await this.load();
    } catch (err) {
      this.toast.error(this.humanize(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async movPage(page: number): Promise<void> {
    try {
      this.movements.set(await this.service.listMovements(this.processId(), { page }));
    } catch {
      this.toast.error('Não foi possível carregar as movimentações.');
    }
  }

  private humanize(err: unknown): string {
    const m = (err as { message?: string })?.message ?? '';
    if (m.includes('Já existe uma coleta')) return 'Já existe uma coleta em andamento ou na fila para essa fonte.';
    if (m.includes('Só processos ativos')) return 'Só é possível coletar processos ativos.';
    if (m.includes('não está disponível para o tribunal')) return 'Essa fonte não está disponível para o tribunal deste processo.';
    if (m.includes('Sem acesso')) return 'Você não tem acesso a este processo.';
    if (m.includes('Habilite o acompanhamento')) return 'Habilite o acompanhamento dessa fonte antes de coletar.';
    return 'Não foi possível concluir a ação.';
  }
}
