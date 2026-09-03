import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { COURT_TYPES, type Court, type CourtType } from '@juriflow/shared-types';
import { CourtService } from './court.service';
import { PermissionService } from '../../core/authorization/permission.service';
import { ToastService } from '../../shared/feedback/toast.service';
import { ButtonComponent } from '../../shared/ui/button.component';
import { CardComponent } from '../../shared/ui/card.component';
import { BadgeComponent } from '../../shared/ui/badge.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';

@Component({
  selector: 'jf-court-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    CardComponent,
    BadgeComponent,
    SpinnerComponent,
    EmptyStateComponent,
  ],
  template: `
    <header class="head"><h1>Tribunais</h1></header>

    @if (canManage()) {
      <jf-card [title]="editingId() ? 'Editar tribunal' : 'Cadastrar tribunal'">
        <form class="form" [formGroup]="form" (ngSubmit)="save()">
          <input class="f" placeholder="Nome" formControlName="name" />
          <select class="f" formControlName="type">
            @for (t of types; track t) {
              <option [value]="t">{{ t }}</option>
            }
          </select>
          <input class="f" placeholder="Jurisdição (UF ou federal…)" formControlName="jurisdiction" />
          <input class="f" placeholder="Código DataJud (opcional)" formControlName="datajudCode" />
          <jf-button type="submit" size="sm" [loading]="saving()">{{ editingId() ? 'Salvar' : 'Cadastrar' }}</jf-button>
          @if (editingId()) {
            <jf-button type="button" size="sm" variant="ghost" (click)="resetForm()">Cancelar</jf-button>
          }
        </form>
      </jf-card>
    }

    <jf-card>
      <label class="inactive-toggle">
        <input type="checkbox" [checked]="includeInactive()" (change)="toggleInactive($event)" />
        Mostrar inativos
      </label>
    </jf-card>

    @if (loading()) {
      <div class="center"><jf-spinner [showLabel]="true" /></div>
    } @else if (courts().length === 0) {
      <jf-empty-state title="Nenhum tribunal cadastrado"><span empty-icon>🏛️</span></jf-empty-state>
    } @else {
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Nome</th><th>Tipo</th><th>Jurisdição</th><th>Status</th>@if (canManage()) {<th></th>}</tr>
          </thead>
          <tbody>
            @for (c of courts(); track c.id) {
              <tr [class.dim]="!c.active">
                <td>{{ c.name }}</td>
                <td>{{ c.type }}</td>
                <td>{{ c.jurisdiction }}</td>
                <td><jf-badge [tone]="c.active ? 'success' : 'neutral'">{{ c.active ? 'ativo' : 'inativo' }}</jf-badge></td>
                @if (canManage()) {
                  <td class="actions">
                    <jf-button size="sm" variant="ghost" (click)="edit(c)">Editar</jf-button>
                    <jf-button size="sm" variant="ghost" (click)="toggleActive(c)">
                      {{ c.active ? 'Desativar' : 'Ativar' }}
                    </jf-button>
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: [
    `
      .head h1 {
        margin: 0 0 1rem;
        font-size: 1.35rem;
      }
      jf-card {
        display: block;
        margin-bottom: 1rem;
      }
      .form {
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
        min-width: 9rem;
        flex: 1 1 9rem;
      }
      .inactive-toggle {
        font-size: 0.875rem;
        display: flex;
        gap: 0.5rem;
        align-items: center;
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
        background: var(--jf-surface, #fff);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.875rem;
      }
      th,
      td {
        text-align: left;
        padding: 0.6rem 1rem;
        border-bottom: 1px solid var(--jf-border, #e2e8f0);
      }
      th {
        background: var(--jf-surface-muted, #f8fafc);
      }
      tr.dim td {
        opacity: 0.55;
      }
      .actions {
        display: flex;
        gap: 0.25rem;
      }
    `,
  ],
})
export class CourtListComponent {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(CourtService);
  private readonly permissions = inject(PermissionService);
  private readonly toast = inject(ToastService);

  protected readonly types = COURT_TYPES;
  protected readonly loading = signal(true);
  protected readonly courts = signal<Court[]>([]);
  protected readonly includeInactive = signal(false);
  protected readonly saving = signal(false);
  protected readonly editingId = signal<string | null>(null);

  protected readonly canManage = (): boolean => this.permissions.can('platform.admin');

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required]],
    type: 'TJ' as CourtType,
    jurisdiction: ['', [Validators.required]],
    datajudCode: '',
  });

  constructor() {
    void this.load();
  }

  protected toggleInactive(event: Event): void {
    this.includeInactive.set((event.target as HTMLInputElement).checked);
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.courts.set(await this.service.list({ includeInactive: this.includeInactive() }));
    } catch {
      this.toast.error('Não foi possível carregar os tribunais.');
    } finally {
      this.loading.set(false);
    }
  }

  protected edit(c: Court): void {
    this.editingId.set(c.id);
    this.form.setValue({
      name: c.name,
      type: c.type,
      jurisdiction: c.jurisdiction,
      datajudCode: c.datajudCode ?? '',
    });
  }

  protected resetForm(): void {
    this.editingId.set(null);
    this.form.reset({ name: '', type: 'TJ', jurisdiction: '', datajudCode: '' });
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    try {
      const v = this.form.getRawValue();
      const id = this.editingId();
      if (id) {
        await this.service.update(id, v);
        this.toast.success('Tribunal atualizado.');
      } else {
        await this.service.create(v);
        this.toast.success('Tribunal cadastrado.');
      }
      this.resetForm();
      await this.load();
    } catch (err) {
      const m = (err as { message?: string })?.message ?? '';
      this.toast.error(
        m.includes('courts_datajud_code_uniq')
          ? 'Já existe um tribunal com esse código DataJud.'
          : 'Não foi possível salvar o tribunal.',
      );
    } finally {
      this.saving.set(false);
    }
  }

  protected async toggleActive(c: Court): Promise<void> {
    try {
      await this.service.setActive(c.id, !c.active);
      await this.load();
    } catch {
      this.toast.error('Não foi possível alterar o status do tribunal.');
    }
  }
}
