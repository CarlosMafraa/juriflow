import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { Court } from '@juriflow/shared-types';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ProcessService, type ProcessFilters, type ProcessListRow } from './process.service';
import type { Page } from '../clients/client.service';
import { CourtService } from '../courts/court.service';
import { SpaceMembersService, type SpaceMemberOption } from '../../core/data/space-members.service';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';
import { ToastService } from '../../shared/feedback/toast.service';

@Component({
  selector: 'jf-process-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonModule,
    CardModule,
    InputTextModule,
    ProgressSpinnerModule,
    SelectModule,
    TableModule,
    TagModule,
  ],
  template: `
    <header class="head">
      <h1>Processos</h1>
      <a routerLink="/processos/novo"><p-button icon="pi pi-plus" label="Novo processo" /></a>
    </header>

    <p-card styleClass="section">
      <form class="filters" [formGroup]="form" (ngSubmit)="apply()">
        <input pInputText class="f" placeholder="Número CNJ" formControlName="cnj" />
        <input pInputText class="f" placeholder="Referência interna" formControlName="internalRef" />
        <p-select class="f" [options]="courtOptions()" formControlName="courtId" placeholder="Tribunal (todos)" />
        <p-select class="f" [options]="memberOptions()" formControlName="assignedUserId" placeholder="Responsável (todos)" />
        <p-select class="f" [options]="statusOptions" formControlName="status" placeholder="Status (todos)" />
        <p-button type="submit" size="small" icon="pi pi-filter" label="Filtrar" />
        <p-button type="button" size="small" severity="secondary" [text]="true" icon="pi pi-filter-slash" label="Limpar" (onClick)="clear()" />
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
            <th>Responsável</th>
            <th>Status</th>
            <th></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr>
            <td>{{ row.cnjNumber || row.internalRef || '—' }}</td>
            <td>{{ row.courtName }}</td>
            <td>{{ row.assignedName }}</td>
            <td>
              <p-tag
                [severity]="row.status === 'active' ? 'success' : row.status === 'closed' ? 'secondary' : 'warn'"
                [value]="row.status"
              />
            </td>
            <td class="actions">
              <a [routerLink]="['/processos', row.id]">
                <p-button size="small" severity="secondary" [outlined]="true" icon="pi pi-arrow-right" label="Abrir" />
              </a>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="5">Nenhum processo encontrado. Ajuste os filtros ou cadastre um novo processo.</td>
          </tr>
        </ng-template>
      </p-table>
      @if (p.rows.length > 0) {
        <div class="pager">
          <p-button size="small" severity="secondary" [text]="true" icon="pi pi-chevron-left" label="Anterior" [disabled]="p.page <= 1" (onClick)="go(p.page - 1)" />
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
  `,
  styles: [
    `
      .head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1rem;
      }
      .head h1 {
        margin: 0;
        font-size: 1.35rem;
      }
      .section {
        display: block;
        margin-bottom: 1rem;
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
  private readonly toast = inject(ToastService);

  protected readonly loading = signal(true);
  protected readonly page = signal<Page<ProcessListRow> | null>(null);
  protected readonly courts = signal<Court[]>([]);
  protected readonly members = signal<SpaceMemberOption[]>([]);

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
    { label: 'Arquivado', value: 'archived' },
    { label: 'Encerrado', value: 'closed' },
  ];

  protected readonly form = this.fb.nonNullable.group({
    cnj: '',
    internalRef: '',
    courtId: '',
    assignedUserId: '',
    status: '',
  });

  private current = 1;

  constructor() {
    void this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    const spaceId = this.activeSpace.activeSpaceId();
    try {
      const [courts, members] = await Promise.all([
        this.courtService.list(),
        spaceId ? this.membersService.listActive(spaceId) : Promise.resolve([]),
      ]);
      this.courts.set(courts);
      this.members.set(members);
    } catch {
      /* filtros opcionais */
    }
    await this.load();
  }

  protected apply(): void {
    this.current = 1;
    void this.load();
  }

  protected clear(): void {
    this.form.reset({ cnj: '', internalRef: '', courtId: '', assignedUserId: '', status: '' });
    this.apply();
  }

  protected go(page: number): void {
    this.current = page;
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const v = this.form.getRawValue();
      const filters: ProcessFilters = {
        cnj: v.cnj,
        internalRef: v.internalRef,
        courtId: v.courtId || undefined,
        assignedUserId: v.assignedUserId || undefined,
        status: (v.status as ProcessFilters['status']) || '',
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
}
