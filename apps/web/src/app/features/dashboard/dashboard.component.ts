import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { SpaceInvite } from '@juriflow/shared-types';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TagModule } from 'primeng/tag';
import { AuthService } from '../../core/auth/auth.service';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';
import { PermissionService } from '../../core/authorization/permission.service';
import { ToastService } from '../../shared/feedback/toast.service';
import { PageHeaderService } from '../../shared/layout/page-header.service';
import { ProcessService, type PlanUsage } from '../processes/process.service';
import { TeamService } from '../team/team.service';
import { ColumnChartComponent, type ColumnPoint } from '../../shared/charts/column-chart.component';
import { DonutChartComponent, type DonutSegment } from '../../shared/charts/donut-chart.component';
import { MeterComponent } from '../../shared/charts/meter.component';
import {
  DashboardService,
  type DashboardMetrics,
  type DayPoint,
  type GrowthPoint,
  type PlanGroup,
  type PlatformMetrics,
  type RecentMovement,
} from './dashboard.service';

/** Qual painel mostrar — cada papel tem o seu. */
type View = 'platform' | 'admin' | 'collaborator' | 'suspended' | 'no-space';

@Component({
  selector: 'jf-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ButtonModule,
    CardModule,
    ProgressSpinnerModule,
    TagModule,
    ColumnChartComponent,
    DonutChartComponent,
    MeterComponent,
  ],
  template: `
    @if (invites().length) {
      <p-card header="Convites recebidos" styleClass="section">
        <ul class="invites">
          @for (i of invites(); track i.id) {
            <li>
              <span>
                <strong>{{ i.spaceName }}</strong> convidou você como
                {{ i.role === 'ADMIN' ? 'Administrador' : 'Colaborador' }}.
              </span>
              <p-button
                size="small"
                icon="pi pi-check"
                label="Aceitar"
                [loading]="accepting() === i.token"
                (onClick)="accept(i)"
              />
            </li>
          }
        </ul>
      </p-card>
    }

    @switch (view()) {
      @case ('no-space') {
        <p class="muted">
          Você ainda não faz parte de nenhum espaço. Quando um escritório convidar você, o convite
          aparece aqui.
        </p>
      }

      @case ('suspended') {
        <p-card styleClass="suspended">
          <h2><i class="pi pi-ban" aria-hidden="true"></i> Espaço suspenso</h2>
          <p>
            O espaço <strong>{{ space()?.name }}</strong> está suspenso pela administração da
            plataforma. Enquanto isso, processos, clientes e configurações ficam indisponíveis e a
            coleta automática fica pausada. Nada foi apagado: ao reativar, tudo volta como estava.
          </p>
        </p-card>
      }

      @case ('platform') {
        @if (platform(); as pm) {
          <section class="grid">
            <a class="metric-link" routerLink="/admin">
              <p-card>
                <p class="label">Espaços ativos</p>
                <p class="metric">{{ pm.activeSpaces }}</p>
                <p class="muted small">
                  @if (pm.pendingSetup > 0) {
                    {{ pm.pendingSetup }} aguardando configuração pelo administrador.
                  } @else {
                    Escritórios usando a plataforma.
                  }
                </p>
              </p-card>
            </a>
            <a class="metric-link" routerLink="/admin">
              <p-card>
                <p class="label">Espaços suspensos</p>
                <p class="metric">{{ pm.suspendedSpaces }}</p>
                <p class="muted small">Sem acesso até serem reativados.</p>
              </p-card>
            </a>
            <a class="metric-link" routerLink="/admin">
              <p-card>
                <p class="label">Usuários na plataforma</p>
                <p class="metric">{{ pm.users }}</p>
                <p class="muted small">Contas criadas, em qualquer espaço.</p>
              </p-card>
            </a>
          </section>

          <section class="charts">
            <p-card header="Espaços por plano" styleClass="chart-card">
              <jf-donut-chart
                [segments]="planSegments()"
                centerLabel="espaços"
                ariaLabel="Espaços por plano"
              />
            </p-card>
            <p-card header="Novos espaços por mês" styleClass="chart-card">
              <jf-column-chart
                [points]="spacesPerMonth()"
                ariaLabel="Novos espaços por mês, últimos 6 meses"
                periodHeader="Mês"
                valueHeader="Novos espaços"
              />
            </p-card>
            <p-card header="Novas contas por mês" class="chart-wide" styleClass="chart-card">
              <jf-column-chart
                [points]="usersPerMonth()"
                ariaLabel="Novas contas de usuário por mês, últimos 6 meses"
                periodHeader="Mês"
                valueHeader="Novas contas"
              />
            </p-card>
          </section>

          <p class="muted small note">
            A administração da plataforma vê apenas que os espaços existem, o status e o plano de
            cada um — nunca o conteúdo dos escritórios.
          </p>
        } @else if (loading()) {
          <div class="center"><p-progressSpinner styleClass="spinner-sm" /></div>
        }
      }

      @default {
        @if (loading()) {
          <div class="center"><p-progressSpinner styleClass="spinner-sm" /></div>
        } @else if (failed()) {
          <p class="muted">Não foi possível carregar os indicadores. Recarregue a página.</p>
        } @else {
          @if (metrics(); as m) {
            <section class="grid">
              <a class="metric-link" routerLink="/processos">
                <p-card>
                  <p class="label">
                    {{ isAdmin() ? 'Processos ativos' : 'Meus processos ativos' }}
                  </p>
                  <p class="metric">{{ m.activeProcesses }}</p>
                  <p class="muted small">
                    {{
                      isAdmin()
                        ? 'Todos os processos ativos do escritório.'
                        : 'Processos sob a sua responsabilidade.'
                    }}
                  </p>
                </p-card>
              </a>
              <p-card>
                <p class="label">Movimentações (7 dias)</p>
                <p class="metric">{{ m.movementsLast7Days }}</p>
                <p class="muted small">
                  {{
                    isAdmin()
                      ? 'Novidades no escritório na última semana.'
                      : 'Novidades nos seus processos.'
                  }}
                </p>
              </p-card>
              @if (isAdmin()) {
                <p-card>
                  <p class="label">Notificações enviadas (30 dias)</p>
                  <p class="metric">{{ m.notificationsSent30Days }}</p>
                  @if (m.notificationsFailed30Days > 0) {
                    <p-tag severity="danger" [value]="m.notificationsFailed30Days + ' com falha'" />
                  } @else {
                    <p class="muted small">Nenhuma falha de envio.</p>
                  }
                </p-card>
              } @else {
                <a class="metric-link" routerLink="/processos" [queryParams]="{ aba: 'archived' }">
                  <p-card>
                    <p class="label">Meus arquivados</p>
                    <p class="metric">{{ m.archivedProcesses }}</p>
                    <p class="muted small">Fora do acompanhamento diário.</p>
                  </p-card>
                </a>
              }
            </section>

            <section class="charts">
              <p-card
                [header]="isAdmin() ? 'Processos por situação' : 'Meus processos por situação'"
                styleClass="chart-card"
              >
                <jf-donut-chart
                  [segments]="statusSegments()"
                  centerLabel="processos"
                  [ariaLabel]="
                    isAdmin()
                      ? 'Processos do escritório por situação'
                      : 'Meus processos por situação'
                  "
                />
              </p-card>

              @if (isAdmin() && plan()) {
                @let pl = plan()!;
                <p-card header="Uso do plano" styleClass="chart-card">
                  <div class="meters">
                    <jf-meter
                      label="Processos"
                      [value]="pl.usedProcesses"
                      [max]="pl.maxProcesses"
                      hint="Ativos, encerrados e arquivados contam; excluídos não."
                    />
                    <jf-meter
                      label="Com sincronização automática"
                      [value]="pl.usedTracked"
                      [max]="pl.maxTracked"
                      hint="Consultados todo dia no tribunal."
                    />
                  </div>
                </p-card>
              } @else if (!isAdmin()) {
                <p-card header="Sincronização dos meus processos" styleClass="chart-card">
                  <div class="meters">
                    <jf-meter
                      label="Ativos com sincronização automática"
                      [value]="m.trackedProcesses"
                      [max]="m.activeProcesses"
                      [limit]="false"
                      hint="Só estes são consultados todo dia no tribunal."
                    />
                  </div>
                </p-card>
              }

              <p-card
                [header]="
                  isAdmin()
                    ? 'Movimentações por dia · 30 dias'
                    : 'Movimentações nos meus processos · 30 dias'
                "
                class="chart-wide"
                styleClass="chart-card"
              >
                <p class="muted small chart-total">{{ movementsTotal() }} no período</p>
                <jf-column-chart
                  [points]="dayPoints()"
                  [labelEvery]="7"
                  ariaLabel="Movimentações coletadas por dia nos últimos 30 dias"
                  periodHeader="Dia"
                  valueHeader="Movimentações"
                />
              </p-card>
            </section>

            @if (m.processesWithCheckError > 0) {
              <p class="alert">
                <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                {{ m.processesWithCheckError }}
                {{ m.processesWithCheckError === 1 ? 'processo teve' : 'processos tiveram' }}
                falha na última consulta ao tribunal.
              </p>
            }

            <p-card header="Movimentações recentes" styleClass="section recent-card">
              @if (recent().length === 0) {
                <p class="muted">
                  Nenhuma movimentação coletada ainda. Processos com número CNJ e sincronização
                  automática são consultados todo dia.
                </p>
              } @else {
                <ul class="recent">
                  @for (r of recent(); track r.id) {
                    <li>
                      <a [routerLink]="['/processos', r.processId]" class="recent__proc">{{
                        r.processLabel
                      }}</a>
                      <span class="recent__date">{{ fmt(r.occurredAt || r.collectedAt) }}</span>
                      <p class="recent__desc">{{ r.description }}</p>
                    </li>
                  }
                </ul>
              }
            </p-card>
          }
        }
      }
    }
  `,
  styles: [
    `
      .muted {
        color: var(--jf-text-muted, #64748b);
      }
      .small {
        font-size: 0.8rem;
        margin: 0;
      }
      .note {
        margin-top: 1rem;
      }
      .center {
        display: flex;
        justify-content: center;
        padding: 2.5rem;
      }
      :host ::ng-deep .spinner-sm {
        width: 2.5rem;
        height: 2.5rem;
      }
      .grid {
        display: grid;
        gap: 1rem;
        grid-template-columns: 1fr;
      }
      @media (min-width: 768px) {
        .grid {
          grid-template-columns: repeat(3, 1fr);
        }
      }
      .metric-link {
        display: block;
        color: inherit;
        text-decoration: none;
      }
      /* Cards da mesma linha com a mesma altura, mesmo quando um tem a tag de falha. */
      :host ::ng-deep .grid .p-card {
        height: 100%;
      }
      .label {
        margin: 0;
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--jf-text-muted, #64748b);
      }
      .metric {
        font-size: 1.75rem;
        font-weight: 800;
        margin: 0.25rem 0;
      }
      .charts {
        display: grid;
        gap: 1rem;
        grid-template-columns: 1fr;
        margin-top: 1rem;
      }
      @media (min-width: 900px) {
        .charts {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        /* No host do p-card (o item do grid), não na div interna do PrimeNG. */
        .chart-wide {
          grid-column: 1 / -1;
        }
      }
      /* Cards da mesma linha com a mesma altura. */
      .charts > p-card {
        display: block;
        min-width: 0;
      }
      :host ::ng-deep .chart-card {
        height: 100%;
      }
      .meters {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }
      .chart-total {
        margin: -0.5rem 0 0.5rem;
      }
      .alert {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin: 1rem 0 0;
        font-size: 0.9rem;
        color: var(--jf-warning-text, #92400e);
      }
      :host ::ng-deep .section {
        display: block;
        margin-bottom: 1rem;
      }
      :host ::ng-deep .recent-card {
        margin-top: 1rem;
      }
      :host ::ng-deep .suspended h2 {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin: 0 0 0.5rem;
        font-size: 1.1rem;
        color: var(--jf-danger, #dc2626);
      }
      .invites,
      .recent {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.8rem;
      }
      .invites li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        flex-wrap: wrap;
      }
      .recent li {
        padding-bottom: 0.8rem;
        border-bottom: 1px solid var(--jf-border, #e2e8f0);
      }
      .recent li:last-child {
        border-bottom: 0;
        padding-bottom: 0;
      }
      .recent__proc {
        font-weight: 600;
        margin-right: 0.5rem;
      }
      .recent__date {
        font-size: 0.8rem;
        color: var(--jf-text-muted, #64748b);
      }
      .recent__desc {
        margin: 0.3rem 0 0;
        font-size: 0.9rem;
      }
    `,
  ],
})
export class DashboardComponent {
  private readonly auth = inject(AuthService);
  private readonly activeSpace = inject(ActiveSpaceService);
  private readonly permissions = inject(PermissionService);
  private readonly service = inject(DashboardService);
  private readonly processes = inject(ProcessService);
  private readonly team = inject(TeamService);
  private readonly toast = inject(ToastService);
  private readonly pageHeader = inject(PageHeaderService);

  protected readonly space = computed(() => this.activeSpace.activeSpace());
  protected readonly isAdmin = computed(() => this.permissions.can('space.manage'));
  protected readonly view = computed<View>(() => {
    const space = this.space();
    if (space?.suspended) return 'suspended';
    if (space) return this.isAdmin() ? 'admin' : 'collaborator';
    return this.auth.authSubject()?.isSuperAdmin ? 'platform' : 'no-space';
  });

  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly metrics = signal<DashboardMetrics | null>(null);
  protected readonly plan = signal<PlanUsage | null>(null);
  protected readonly platform = signal<PlatformMetrics | null>(null);
  protected readonly recent = signal<RecentMovement[]>([]);
  private readonly perDay = signal<DayPoint[]>([]);
  private readonly growth = signal<GrowthPoint[]>([]);
  private readonly plans = signal<PlanGroup[]>([]);

  // Cor segue a situação (nunca a posição): ativo = slot 1, encerrado = 2, arquivado = 3.
  protected readonly statusSegments = computed<DonutSegment[]>(() => {
    const m = this.metrics();
    if (!m) return [];
    return [
      { key: 'active', label: 'Ativos', value: m.activeProcesses, color: 'var(--jf-viz-1)' },
      { key: 'closed', label: 'Encerrados', value: m.closedProcesses, color: 'var(--jf-viz-2)' },
      {
        key: 'archived',
        label: 'Arquivados',
        value: m.archivedProcesses,
        color: 'var(--jf-viz-3)',
      },
    ];
  });

  protected readonly dayPoints = computed<ColumnPoint[]>(() =>
    this.perDay().map((d) => {
      const [y, mo, da] = d.day.split('-');
      return { label: `${da}/${mo}`, title: `${da}/${mo}/${y}`, value: d.total };
    }),
  );
  protected readonly movementsTotal = computed(() =>
    this.perDay().reduce((sum, d) => sum + d.total, 0),
  );

  protected readonly spacesPerMonth = computed<ColumnPoint[]>(() =>
    this.growth().map((g) => ({ ...monthLabels(g.month), value: g.newSpaces })),
  );
  protected readonly usersPerMonth = computed<ColumnPoint[]>(() =>
    this.growth().map((g) => ({ ...monthLabels(g.month), value: g.newUsers })),
  );

  // Planos têm ordem (menor -> maior): rampa de uma cor, clara -> escura.
  // Mais de 4 combinações: as maiores viram "Outros planos".
  protected readonly planSegments = computed<DonutSegment[]>(() => {
    const ramp = [
      'var(--jf-viz-ord-1)',
      'var(--jf-viz-ord-2)',
      'var(--jf-viz-ord-3)',
      'var(--jf-viz-ord-4)',
    ];
    const groups = this.plans();
    const head = groups.length > 4 ? groups.slice(0, 3) : groups;
    const segments = head.map((g, i) => ({
      key: `${g.maxProcesses}/${g.maxTracked}`,
      label: `${g.maxProcesses} processos · ${g.maxTracked} sincronizados`,
      value: g.spaces,
      color: ramp[i]!,
    }));
    if (groups.length > 4) {
      segments.push({
        key: 'outros',
        label: 'Outros planos',
        value: groups.slice(3).reduce((sum, g) => sum + g.spaces, 0),
        color: 'var(--jf-viz-other)',
      });
    }
    return segments;
  });
  protected readonly invites = signal<SpaceInvite[]>([]);
  protected readonly accepting = signal<string | null>(null);

  constructor() {
    // Recarrega ao trocar de espaço ativo (seletor da sidebar) ou de papel.
    effect(
      () => {
        const view = this.view();
        const space = this.space();
        this.pageHeader.set(
          'Dashboard',
          view === 'platform' ? 'Administração da plataforma' : (space?.name ?? undefined),
        );
        void this.load(view, space?.id ?? null);
      },
      { allowSignalWrites: true },
    );
  }

  protected fmt(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('pt-BR');
  }

  protected async accept(invite: SpaceInvite): Promise<void> {
    if (!invite.token) return;
    this.accepting.set(invite.token);
    try {
      await this.team.acceptInvite(invite.token);
      await this.auth.refreshContext();
      this.activeSpace.setActiveSpace(invite.spaceId);
      this.toast.success('Convite aceito.');
    } catch {
      this.toast.error('Não foi possível aceitar o convite.');
    } finally {
      this.accepting.set(null);
    }
  }

  private async load(view: View, spaceId: string | null): Promise<void> {
    this.loading.set(true);
    this.failed.set(false);
    try {
      this.invites.set(await this.team.listMyPendingInvites().catch(() => []));
      if (view === 'platform') {
        const [platform, growth, plans] = await Promise.all([
          this.service.platformMetrics(),
          this.service.platformGrowth(6),
          this.service.spacesByPlan(),
        ]);
        this.platform.set(platform);
        this.growth.set(growth);
        this.plans.set(plans);
      } else if ((view === 'admin' || view === 'collaborator') && spaceId) {
        const [metrics, recent, plan, perDay] = await Promise.all([
          this.service.metrics(spaceId),
          this.service.recentMovements(spaceId),
          view === 'admin' ? this.processes.planUsage() : Promise.resolve(null),
          this.service.movementsPerDay(spaceId, 30),
        ]);
        this.metrics.set(metrics);
        this.recent.set(recent);
        this.perDay.set(perDay);
        this.plan.set(plan);
      }
    } catch {
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "2026-09-01" -> eixo "set/26", tooltip "setembro de 2026". */
function monthLabels(isoMonth: string): { label: string; title: string } {
  const [y, m] = isoMonth.split('-');
  const index = Number(m) - 1;
  const long = new Date(Number(y), index, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });
  return { label: `${MONTHS[index] ?? m}/${y?.slice(2)}`, title: long };
}
