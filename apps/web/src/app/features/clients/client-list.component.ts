import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ClientService, type Page } from './client.service';
import type { Client } from '@juriflow/shared-types';
import { ToastService } from '../../shared/feedback/toast.service';
import { ButtonComponent } from '../../shared/ui/button.component';
import { CardComponent } from '../../shared/ui/card.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { BadgeComponent } from '../../shared/ui/badge.component';

@Component({
  selector: 'jf-client-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    SpinnerComponent,
    BadgeComponent,
  ],
  template: `
    <header class="head">
      <h1>Clientes</h1>
      <a routerLink="/clientes/novo"><jf-button>Novo cliente</jf-button></a>
    </header>

    <jf-card>
      <form class="filters" [formGroup]="form" (ngSubmit)="apply()">
        <input class="f" placeholder="Nome" formControlName="search" />
        <input class="f" placeholder="CPF / CNPJ" formControlName="document" />
        <select class="f" formControlName="type">
          <option value="">Tipo (todos)</option>
          <option value="PF">Pessoa física</option>
          <option value="PJ">Pessoa jurídica</option>
        </select>
        <input class="f" placeholder="Telefone" formControlName="phone" />
        <input class="f" placeholder="E-mail" formControlName="email" />
        <jf-button type="submit" size="sm">Filtrar</jf-button>
        <jf-button type="button" size="sm" variant="ghost" (click)="clear()">Limpar</jf-button>
      </form>
    </jf-card>

    @if (loading()) {
      <div class="center"><jf-spinner [showLabel]="true" /></div>
    } @else if (page()) {
      @let p = page()!;
      @if (p.rows.length === 0) {
        <jf-empty-state title="Nenhum cliente encontrado" message="Ajuste os filtros ou cadastre um novo cliente.">
          <span empty-icon>🧑</span>
        </jf-empty-state>
      } @else {
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr><th>Nome</th><th>Tipo</th><th>Documento</th><th>Contato</th><th></th></tr>
            </thead>
            <tbody>
              @for (c of p.rows; track c.id) {
                <tr>
                  <td data-label="Nome">{{ c.name }}</td>
                  <td data-label="Tipo"><jf-badge>{{ c.type }}</jf-badge></td>
                  <td data-label="Documento">{{ c.document || '—' }}</td>
                  <td data-label="Contato">{{ c.phone || c.email || '—' }}</td>
                  <td data-label="" class="actions">
                    <a [routerLink]="['/clientes', c.id]"><jf-button size="sm" variant="secondary">Abrir</jf-button></a>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="pager">
          <jf-button size="sm" variant="ghost" [disabled]="p.page <= 1" (click)="go(p.page - 1)">Anterior</jf-button>
          <span>Página {{ p.page }} — {{ p.total }} cliente(s)</span>
          <jf-button
            size="sm"
            variant="ghost"
            [disabled]="p.page * p.pageSize >= p.total"
            (click)="go(p.page + 1)"
          >
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
        flex: 1 1 8rem;
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
export class ClientListComponent {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(ClientService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly page = signal<Page<Client> | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    search: '',
    document: '',
    type: '',
    phone: '',
    email: '',
  });

  private current = 1;

  constructor() {
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
