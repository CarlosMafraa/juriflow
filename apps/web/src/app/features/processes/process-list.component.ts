import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { Court } from '@juriflow/shared-types';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import {
  ProcessService,
  type DeletedProcessRow,
  type PlanUsage,
  type ProcessFilters,
  type ProcessListRow,
  type ProcessScope,
} from './process.service';
import { PROCESS_STATUS_LABEL, processStatusSeverity } from './process-status';
import type { Page } from '../clients/client.service';
import { CourtService } from '../courts/court.service';
import { SpaceMembersService, type SpaceMemberOption } from '../../core/data/space-members.service';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';
import { PermissionService } from '../../core/authorization/permission.service';
import { DialogService } from '../../shared/ui/dialog.service';
import { ToastService } from '../../shared/feedback/toast.service';
import { PageHeaderActionsDirective } from '../../shared/layout/page-header-actions.directive';
import { PageHeaderService } from '../../shared/layout/page-header.service';

type Tab = ProcessScope | 'deleted';

const SUBTITLE: Record<Tab, { admin: string; colab: string }> = {
  mine: {
    admin: 'Processos sob a sua responsabilidade',
    colab: 'Processos sob a sua responsabilidade',
  },
  all: { admin: 'Todos os processos do escritório', colab: '' },
  archived: {
    admin: 'Arquivados do escritório — reative ou exclua a partir daqui',
    colab: 'Seus processos arquivados',
  },
  deleted: { admin: 'Excluídos — podem ser restaurados para os arquivados', colab: '' },
};

@Component({
  selector: 'jf-process-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    RouterLink,
    ButtonModule,
    CardModule,
    InputTextModule,
    ProgressSpinnerModule,
    SelectModule,
    SelectButtonModule,
    TableModule,
    TagModule,
    PageHeaderActionsDirective,
  ],
  template: `
    <ng-template jfPageHeaderActions>
      @if (planFull()) {
        <p-button size="small" icon="pi pi-plus" label="Novo processo" [disabled]="true" />
      } @else {
        <a routerLink="/processos/novo"
          ><p-button size="small" icon="pi pi-plus" label="Novo processo"
        /></a>
      }
    </ng-template>

    <div class="toolbar">
      <p-selectButton
        [options]="tabOptions()"
        [ngModel]="tab()"
        (ngModelChange)="selectTab($event)"
        [allowEmpty]="false"
        optionLabel="label"
        optionValue="value"
        aria-label="Listas de processos"
      />
      @if (usage(); as u) {
        <span class="usage" [class.usage--full]="planFull()">
          {{ u.usedProcesses }} de {{ u.maxProcesses }} processos do plano · {{ u.usedTracked }} de
          {{ u.maxTracked }} com sincronização automática
        </span>
      }
    </div>
    @if (planFull()) {
      <p class="plan-full">
        O limite de processos do plano foi atingido. Exclua processos arquivados ou fale com a
        administração da plataforma para ampliar o plano.
      </p>
    }

    @if (tab() === 'deleted') {
      @if (loading()) {
        <div class="center"><p-progressSpinner styleClass="spinner-sm" /></div>
      } @else {
        <p-table [value]="deleted()" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th>Número / Ref.</th>
              <th>Tribunal</th>
              <th>Excluído em</th>
              <th></th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td>{{ row.cnjNumber || row.internalRef || '—' }}</td>
              <td>{{ row.courtName }}</td>
              <td>{{ fmt(row.deletedAt) }}</td>
              <td class="actions">
                <p-button
                  size="small"
                  severity="secondary"
                  [outlined]="true"
                  icon="pi pi-replay"
                  label="Restaurar"
                  (onClick)="restore(row)"
                />
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="4">Nenhum processo excluído.</td>
            </tr>
          </ng-template>
        </p-table>
      }
    } @else {
      <p-card styleClass="section">
        <form class="filters" [formGroup]="form" (ngSubmit)="apply()">
          <input pInputText class="f" placeholder="Número CNJ" formControlName="cnj" />
          <input
            pInputText
            class="f"
            placeholder="Referência interna"
            formControlName="internalRef"
          />
          <p-select
            class="f"
            [options]="courtOptions()"
            formControlName="courtId"
            placeholder="Tribunal (todos)"
          />
          @if (tab() === 'all') {
            <p-select
              class="f"
              [options]="memberOptions()"
              formControlName="responsibleId"
              placeholder="Responsável (todos)"
            />
          }
          @if (tab() !== 'archived') {
            <p-select
              class="f"
              [options]="statusOptions"
              formControlName="status"
              placeholder="Status (todos)"
            />
          }
          <p-button type="submit" size="small" icon="pi pi-filter" label="Filtrar" />
          <p-button
            type="button"
            size="small"
            severity="secondary"
            [text]="true"
            icon="pi pi-filter-slash"
            label="Limpar"
            (onClick)="clear()"
          />
        </form>
      </p-card>

      @if (loading()) {
        <div class="center"><p-progressSpinner styleClass="spinner-sm" /></div>
      } @else if (page()) {
        @let p = page()!;
        <p-table [value]="p.rows" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th>Número / Ref.</th>
              <th>Tribunal</th>
              <th>Responsáveis</th>
              <th>Status</th>
              <th></th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td>{{ row.cnjNumber || row.internalRef || '—' }}</td>
              <td>{{ row.courtName }}</td>
              <td>{{ row.responsibleNames }}</td>
              <td>
                <p-tag [severity]="severity(row.status)" [value]="statusText(row.status)" />
              </td>
              <td class="actions">
                @if (tab() === 'archived' && isAdmin()) {
                  <p-button
                    size="small"
                    severity="secondary"
                    [outlined]="true"
                    icon="pi pi-refresh"
                    label="Reativar"
                    (onClick)="reactivate(row)"
                  />
                  <p-button
                    size="small"
                    severity="danger"
                    [outlined]="true"
                    icon="pi pi-trash"
                    label="Excluir"
                    (onClick)="remove(row)"
                  />
                }
                <a [routerLink]="['/processos', row.id]">
                  <p-button
                    size="small"
                    severity="secondary"
                    [outlined]="true"
                    icon="pi pi-arrow-right"
                    label="Abrir"
                  />
                </a>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="5">{{ emptyMessage() }}</td>
            </tr>
          </ng-template>
        </p-table>
        @if (p.rows.length > 0) {
          <div class="pager">
            <p-button
              size="small"
              severity="secondary"
              [text]="true"
              icon="pi pi-chevron-left"
              label="Anterior"
              [disabled]="p.page <= 1"
              (onClick)="go(p.page - 1)"
            />
            <span>Página {{ p.page }} — {{ p.total }} processo(s)</span>
            <p-button
              size="small"
              severity="secondary"
              [text]="true"
              icon="pi pi-chevron-right"
              iconPos="right"
              label="Próxima"
              [disabled]="p.page * p.pageSize >= p.total"
              (onClick)="go(p.page + 1)"
            />
          </div>
        }
      }
    }
  `,
  styles: [
    `
      /* styleClass do p-card cai num div interno do template do PrimeNG, fora
         do encapsulamento deste componente — precisa de ::ng-deep, senão a
         regra nunca é aplicada (bug real: filtro colava na tabela, gap 0). */
      :host ::ng-deep .section {
        display: block;
        margin-bottom: 1rem;
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        margin-bottom: 1rem;
      }
      .usage {
        font-size: 0.8rem;
        color: var(--jf-text-muted, #64748b);
      }
      .usage--full {
        color: var(--jf-warning-text, #92400e);
        font-weight: 600;
      }
      .plan-full {
        margin: -0.25rem 0 1rem;
        font-size: 0.85rem;
        color: var(--jf-warning-text, #92400e);
      }
      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
      }
      .f {
        min-width: 9rem;
        flex: 1 1 9rem;
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
      .actions {
        text-align: right;
        white-space: nowrap;
      }
      .actions p-button,
      .actions a {
        margin-left: 0.35rem;
      }
      .pager {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        margin-top: 1rem;
        font-size: 0.85rem;
        color: var(--jf-text-muted, #64748b);
      }
    `,
  ],
})
export class ProcessListComponent {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(ProcessService);
  private readonly courtService = inject(CourtService);
  private readonly membersService = inject(SpaceMembersService);
  private readonly activeSpace = inject(ActiveSpaceService);
  private readonly permissions = inject(PermissionService);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly pageHeader = inject(PageHeaderService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly statusText = (s: ProcessListRow['status']): string => PROCESS_STATUS_LABEL[s];
  protected readonly severity = processStatusSeverity;
  protected readonly isAdmin = computed(() => this.permissions.can('space.manage'));

  protected readonly tab = signal<Tab>('mine');
  protected readonly loading = signal(true);
  protected readonly page = signal<Page<ProcessListRow> | null>(null);
  protected readonly deleted = signal<DeletedProcessRow[]>([]);
  protected readonly courts = signal<Court[]>([]);
  protected readonly members = signal<SpaceMemberOption[]>([]);
  protected readonly usage = signal<PlanUsage | null>(null);
  protected readonly planFull = computed(() => {
    const u = this.usage();
    return !!u && u.usedProcesses >= u.maxProcesses;
  });

  protected readonly tabOptions = computed(() =>
    this.isAdmin()
      ? [
          { label: 'Meus processos', value: 'mine' },
          { label: 'Todos', value: 'all' },
          { label: 'Arquivados', value: 'archived' },
          { label: 'Excluídos', value: 'deleted' },
        ]
      : [
          { label: 'Meus processos', value: 'mine' },
          { label: 'Arquivados', value: 'archived' },
        ],
  );

  protected readonly courtOptions = computed(() => [
    { label: 'Tribunal (todos)', value: '' },
    ...this.courts().map((c) => ({ label: c.name, value: c.id })),
  ]);
  protected readonly memberOptions = computed(() => [
    { label: 'Responsável (todos)', value: '' },
    ...this.members().map((m) => ({ label: m.fullName, value: m.profileId })),
  ]);
  protected readonly statusOptions = [
    { label: 'Status (todos)', value: '' },
    { label: 'Ativo', value: 'active' },
    { label: 'Encerrado', value: 'closed' },
  ];
  protected readonly emptyMessage = computed(() =>
    this.tab() === 'archived'
      ? 'Nenhum processo arquivado.'
      : 'Nenhum processo encontrado. Ajuste os filtros ou cadastre um novo processo.',
  );

  protected readonly form = this.fb.nonNullable.group({
    cnj: '',
    internalRef: '',
    courtId: '',
    responsibleId: '',
    status: '',
  });

  private current = 1;

  constructor() {
    const requested = this.route.snapshot.queryParamMap.get('aba') as Tab | null;
    const allowed = this.tabOptions().map((t) => t.value);
    this.tab.set(requested && allowed.includes(requested) ? requested : 'mine');
    this.updateHeader();
    void this.bootstrap();
  }

  protected fmt(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR');
  }

  protected selectTab(tab: Tab): void {
    if (!tab || tab === this.tab()) return;
    this.tab.set(tab);
    this.current = 1;
    this.updateHeader();
    void this.router.navigate([], { queryParams: { aba: tab }, replaceUrl: true });
    void this.load();
  }

  private updateHeader(): void {
    const texts = SUBTITLE[this.tab()];
    this.pageHeader.set('Processos', this.isAdmin() ? texts.admin : texts.colab);
  }

  private async bootstrap(): Promise<void> {
    const spaceId = this.activeSpace.activeSpaceId();
    try {
      const [courts, members, usage] = await Promise.all([
        this.courtService.list(),
        spaceId && this.isAdmin() ? this.membersService.listActive(spaceId) : Promise.resolve([]),
        this.service.planUsage(),
      ]);
      this.courts.set(courts);
      this.members.set(members);
      this.applyUsage(usage);
    } catch {
      /* filtros e uso do plano são opcionais */
    }
    await this.load();
  }

  protected apply(): void {
    this.current = 1;
    void this.load();
  }

  protected clear(): void {
    this.form.reset({ cnj: '', internalRef: '', courtId: '', responsibleId: '', status: '' });
    this.apply();
  }

  protected go(page: number): void {
    this.current = page;
    void this.load();
  }

  protected async reactivate(row: ProcessListRow): Promise<void> {
    try {
      await this.service.setStatus(row.id, 'active');
      this.toast.success('Processo reativado.');
      await this.refresh();
    } catch (err) {
      this.toast.error(this.humanize(err, 'Não foi possível reativar o processo.'));
    }
  }

  protected async remove(row: ProcessListRow): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Excluir processo',
      message: `Excluir o processo ${row.cnjNumber || row.internalRef || ''}? Ele sai das listas e da contagem do plano. O histórico e a auditoria são mantidos, e ele pode ser restaurado na aba Excluídos.`,
      confirmLabel: 'Excluir',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await this.service.softDelete(row.id);
      this.toast.success('Processo excluído.');
      await this.refresh();
    } catch (err) {
      this.toast.error(this.humanize(err, 'Não foi possível excluir o processo.'));
    }
  }

  protected async restore(row: DeletedProcessRow): Promise<void> {
    try {
      await this.service.restore(row.id);
      this.toast.success('Processo restaurado para os arquivados.');
      await this.refresh();
    } catch (err) {
      this.toast.error(this.humanize(err, 'Não foi possível restaurar o processo.'));
    }
  }

  private async refresh(): Promise<void> {
    try {
      this.applyUsage(await this.service.planUsage());
    } catch {
      /* opcional */
    }
    await this.load();
  }

  /** ADMIN acompanha o uso do plano; o colaborador só vê quando o limite trava o cadastro. */
  private applyUsage(usage: PlanUsage): void {
    this.usage.set(this.isAdmin() || usage.usedProcesses >= usage.maxProcesses ? usage : null);
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      if (this.tab() === 'deleted') {
        this.deleted.set(await this.service.listDeleted());
        return;
      }
      const v = this.form.getRawValue();
      const filters: ProcessFilters = {
        scope: this.tab() as ProcessScope,
        cnj: v.cnj,
        internalRef: v.internalRef,
        courtId: v.courtId || undefined,
        responsibleId: this.tab() === 'all' ? v.responsibleId || undefined : undefined,
        status: this.tab() === 'archived' ? '' : (v.status as ProcessFilters['status']) || '',
        page: this.current,
      };
      this.page.set(await this.service.list(filters));
    } catch {
      this.toast.error('Não foi possível carregar os processos.');
      this.page.set({ rows: [], total: 0, page: 1, pageSize: 20 });
    } finally {
      this.loading.set(false);
    }
  }

  private humanize(err: unknown, fallback: string): string {
    const e = err as { code?: string; message?: string };
    // Mensagens de regra do banco (limite do plano, arquivar antes etc.) já são para o usuário.
    return e?.code === '23514' && e.message ? e.message : fallback;
  }
}
