import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ClientService, type Page } from './client.service';
import type { Client } from '@juriflow/shared-types';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ToastService } from '../../shared/feedback/toast.service';
import { PageHeaderActionsDirective } from '../../shared/layout/page-header-actions.directive';
import { PageHeaderService } from '../../shared/layout/page-header.service';

@Component({
  selector: 'jf-client-list',
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
    PageHeaderActionsDirective,
  ],
  template: `
    <ng-template jfPageHeaderActions>
      <a routerLink="/clientes/novo"
        ><p-button size="small" icon="pi pi-plus" label="Novo cliente"
      /></a>
    </ng-template>

    <p-card styleClass="section">
      <form class="filters" [formGroup]="form" (ngSubmit)="apply()">
        <input pInputText class="f" placeholder="Nome" formControlName="search" />
        <input pInputText class="f" placeholder="CPF / CNPJ" formControlName="document" />
        <p-select
          class="f"
          [options]="typeOptions"
          formControlName="type"
          placeholder="Tipo (todos)"
        />
        <input pInputText class="f" placeholder="Telefone" formControlName="phone" />
        <input pInputText class="f" placeholder="E-mail" formControlName="email" />
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
            <th>Nome</th>
            <th>Tipo</th>
            <th>Documento</th>
            <th>Contato</th>
            <th></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-c>
          <tr>
            <td>{{ c.name }}</td>
            <td><p-tag severity="secondary" [value]="c.type" /></td>
            <td>{{ c.document || '—' }}</td>
            <td>{{ c.phone || c.email || '—' }}</td>
            <td class="actions">
              <a [routerLink]="['/clientes', c.id]">
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
            <td colspan="5">
              Nenhum cliente encontrado. Ajuste os filtros ou cadastre um novo cliente.
            </td>
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
          <span>Página {{ p.page }} — {{ p.total }} cliente(s)</span>
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
         regra nunca é aplicada (bug real: filtro colava na tabela, gap 0). */
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
        min-width: 8rem;
        flex: 1 1 8rem;
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
export class ClientListComponent {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(ClientService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly pageHeader = inject(PageHeaderService);

  protected readonly loading = signal(true);
  protected readonly page = signal<Page<Client> | null>(null);

  protected readonly typeOptions = [
    { label: 'Tipo (todos)', value: '' },
    { label: 'Pessoa física', value: 'PF' },
    { label: 'Pessoa jurídica', value: 'PJ' },
  ];

  protected readonly form = this.fb.nonNullable.group({
    search: '',
    document: '',
    type: '',
    phone: '',
    email: '',
  });

  private current = 1;

  constructor() {
    this.pageHeader.set('Clientes', 'Todos os clientes do espaço');
    void this.load();
  }

  protected apply(): void {
    this.current = 1;
    void this.load();
  }

  protected clear(): void {
    this.form.reset({ search: '', document: '', type: '', phone: '', email: '' });
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
          search: v.search,
          document: v.document,
          type: (v.type as 'PF' | 'PJ' | '') || '',
          phone: v.phone,
          email: v.email,
          page: this.current,
        }),
      );
    } catch (err) {
      this.toast.error('Não foi possível carregar os clientes.');
      this.page.set({ rows: [], total: 0, page: 1, pageSize: 20 });
      void err;
    } finally {
      this.loading.set(false);
    }
  }
}
