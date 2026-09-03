import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { Court } from '@juriflow/shared-types';
import { ProcessService, type ProcessFilters, type ProcessListRow } from './process.service';
import type { Page } from '../clients/client.service';
import { CourtService } from '../courts/court.service';
import { SpaceMembersService, type SpaceMemberOption } from '../../core/data/space-members.service';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';
import { ToastService } from '../../shared/feedback/toast.service';
import { ButtonComponent } from '../../shared/ui/button.component';
import { CardComponent } from '../../shared/ui/card.component';
import { BadgeComponent } from '../../shared/ui/badge.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';

@Component({
  selector: 'jf-process-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonComponent,
    CardComponent,
    BadgeComponent,
    SpinnerComponent,
    EmptyStateComponent,
  ],
  template: `
    <header class="head">
      <h1>Processos</h1>
      <a routerLink="/processos/novo"><jf-button>Novo processo</jf-button></a>
    </header>

    <jf-card>
      <form class="filters" [formGroup]="form" (ngSubmit)="apply()">
        <input class="f" placeholder="Número CNJ" formControlName="cnj" />
        <input class="f" placeholder="Referência interna" formControlName="internalRef" />
        <select class="f" formControlName="courtId">
          <option value="">Tribunal (todos)</option>
          @for (c of courts(); track c.id) {
            <option [value]="c.id">{{ c.name }}</option>
          }
        </select>
        <select class="f" formControlName="assignedUserId">
          <option value="">Responsável (todos)</option>
          @for (m of members(); track m.profileId) {
            <option [value]="m.profileId">{{ m.fullName }}</option>
          }
        </select>
        <select class="f" formControlName="status">
          <option value="">Status (todos)</option>
          <option value="active">Ativo</option>
          <option value="archived">Arquivado</option>
          <option value="closed">Encerrado</option>
        </select>
        <jf-button type="submit" size="sm">Filtrar</jf-button>
        <jf-button type="button" size="sm" variant="ghost" (click)="clear()">Limpar</jf-button>
      </form>
    </jf-card>

    @if (loading()) {
      <div class="center"><jf-spinner [showLabel]="true" /></div>
    } @else if (page()) {
      @let p = page()!;
      @if (p.rows.length === 0) {
        <jf-empty-state title="Nenhum processo encontrado" message="Ajuste os filtros ou cadastre um novo processo.">
          <span empty-icon>⚖️</span>
        </jf-empty-state>
      } @else {
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr><th>Número / Ref.</th><th>Tribunal</th><th>Responsável</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              @for (row of p.rows; track row.id) {
                <tr>
                  <td data-label="Número / Ref.">{{ row.cnjNumber || row.internalRef || '—' }}</td>
                  <td data-label="Tribunal">{{ row.courtName }}</td>
                  <td data-label="Responsável">{{ row.assignedName }}</td>
                  <td data-label="Status">
                    <jf-badge [tone]="row.status === 'active' ? 'success' : row.status === 'closed' ? 'neutral' : 'warning'">
                      {{ row.status }}
                    </jf-badge>
                  </td>
                  <td data-label="" class="actions">
                    <a [routerLink]="['/processos', row.id]"><jf-button size="sm" variant="secondary">Abrir</jf-button></a>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="pager">
          <jf-button size="sm" variant="ghost" [disabled]="p.page <= 1" (click)="go(p.page - 1)">Anterior</jf-button>
          <span>Página {{ p.page }} — {{ p.total }} processo(s)</span>
          <jf-button size="sm" variant="ghost" [disabled]="p.page * p.pageSize >= p.total" (click)="go(p.page + 1)">
            Próxima
          </jf-button>
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
      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
      }
      .f {
        font: inherit;
        padding: 0.45rem 0.6rem;
        border: 1px solid var(--jf-border, #cbd5e1);
        border-radius: var(--jf-radius, 8px);
        min-width: 8rem;
        flex: 1 1 9rem;
      }
      .center {
        display: flex;
        justify-content: center;
        padding: 2.5rem;
      }
      .table-wrap {
        overflow-x: auto;
        border: 1px solid var(--jf-border, #e2e8f0);
        border-radius: var(--jf-radius-lg, 12px);
        margin-top: 1rem;
        background: var(--jf-surface, #fff);
      }
      .table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.875rem;
      }
      .table th,
      .table td {
        padding: 0.7rem 1rem;
        border-bottom: 1px solid var(--jf-border, #e2e8f0);
        text-align: left;
      }
      .table th {
        background: var(--jf-surface-muted, #f8fafc);
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
      @media (max-width: 767px) {
        .table thead {
          display: none;
        }
        .table tr {
          display: block;
          border-bottom: 2px solid var(--jf-border, #e2e8f0);
        }
        .table td {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          border: 0;
          padding: 0.4rem 1rem;
        }
        .table td::before {
          content: attr(data-label);
          font-weight: 600;
          color: var(--jf-text-muted, #64748b);
        }
        .actions {
          justify-content: flex-end;
        }
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
