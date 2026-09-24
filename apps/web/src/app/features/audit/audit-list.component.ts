import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { AUDIT_ACTIONS } from '@juriflow/domain';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { AuditService, type AuditLogEntry } from './audit.service';
import type { Page } from '../clients/client.service';
import { ToastService } from '../../shared/feedback/toast.service';
import { PageHeaderService } from '../../shared/layout/page-header.service';

const ACTION_OPTIONS = [
  { label: 'Ação (todas)', value: '' },
  ...Object.values(AUDIT_ACTIONS)
    .sort()
    .map((action) => ({ label: action, value: action })),
];

@Component({
  selector: 'jf-audit-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    ButtonModule,
    CardModule,
    InputTextModule,
    ProgressSpinnerModule,
    SelectModule,
    TableModule,
    TagModule,
  ],
  template: `
    <p-card styleClass="section">
      <form class="filters" [formGroup]="form" (ngSubmit)="apply()">
        <p-select class="f" [options]="actionOptions" formControlName="action" placeholder="Ação (todas)" />
        <input pInputText class="f" placeholder="Tipo de entidade (ex: process, client)" formControlName="entityType" />
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
            <th>Quando</th>
            <th>Ação</th>
            <th>Ator</th>
            <th>Entidade</th>
            <th>Resultado</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-l>
          <tr>
            <td>{{ l.createdAt | date: 'dd/MM/yyyy HH:mm:ss' }}</td>
            <td>{{ l.action }}</td>
            <td>{{ l.actorName || l.actorType }}</td>
            <td>{{ l.entityType ? l.entityType + ' · ' + (l.entityId || '—') : '—' }}</td>
            <td><p-tag [severity]="l.result === 'success' ? 'success' : 'danger'" [value]="l.result" /></td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="5">Nenhum evento encontrado para os filtros selecionados.</td>
          </tr>
        </ng-template>
      </p-table>
      @if (p.rows.length > 0) {
        <div class="pager">
          <p-button size="small" severity="secondary" [text]="true" icon="pi pi-chevron-left" label="Anterior" [disabled]="p.page <= 1" (onClick)="go(p.page - 1)" />
          <span>Página {{ p.page }} — {{ p.total }} evento(s)</span>
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
      /* styleClass do p-card cai num div interno do template do PrimeNG, fora
         do encapsulamento deste componente — precisa de ::ng-deep, senão a
         regra nunca é aplicada. */
      :host ::ng-deep .section {
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
        min-width: 12rem;
        flex: 1 1 12rem;
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
export class AuditListComponent {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(AuditService);
  private readonly toast = inject(ToastService);
  private readonly pageHeader = inject(PageHeaderService);

  protected readonly actionOptions = ACTION_OPTIONS;
  protected readonly loading = signal(true);
  protected readonly page = signal<Page<AuditLogEntry> | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    action: '',
    entityType: '',
  });

  private current = 1;

  constructor() {
    this.pageHeader.set('Auditoria', 'Trilha de eventos do espaço — imutável, não editável.');
    void this.load();
  }

  protected apply(): void {
    this.current = 1;
    void this.load();
  }

  protected clear(): void {
    this.form.reset({ action: '', entityType: '' });
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
      this.page.set(
        await this.service.list({
          action: v.action || undefined,
          entityType: v.entityType || undefined,
          page: this.current,
        }),
      );
    } catch {
      this.toast.error('Não foi possível carregar a auditoria.');
      this.page.set({ rows: [], total: 0, page: 1, pageSize: 20 });
    } finally {
      this.loading.set(false);
    }
  }
}
