import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { COURT_TYPES, type Court, type CourtType } from '@juriflow/shared-types';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { CourtService } from './court.service';
import { PermissionService } from '../../core/authorization/permission.service';
import { ToastService } from '../../shared/feedback/toast.service';

@Component({
  selector: 'jf-court-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    ButtonModule,
    CardModule,
    CheckboxModule,
    InputTextModule,
    ProgressSpinnerModule,
    SelectModule,
    TableModule,
    TagModule,
  ],
  template: `
    <header class="head"><h1>Tribunais</h1></header>

    @if (canManage()) {
      <p-card [header]="editingId() ? 'Editar tribunal' : 'Cadastrar tribunal'" styleClass="section">
        <form class="form" [formGroup]="form" (ngSubmit)="save()">
          <input pInputText class="f" placeholder="Nome" formControlName="name" />
          <p-select
            class="f"
            [options]="types"
            formControlName="type"
            placeholder="Tipo"
          />
          <input pInputText class="f" placeholder="Jurisdição (UF ou federal…)" formControlName="jurisdiction" />
          <input pInputText class="f" placeholder="Código DataJud (opcional)" formControlName="datajudCode" />
          <p-button type="submit" size="small" [label]="editingId() ? 'Salvar' : 'Cadastrar'" [loading]="saving()" />
          @if (editingId()) {
            <p-button type="button" size="small" severity="secondary" [text]="true" label="Cancelar" (onClick)="resetForm()" />
          }
        </form>
      </p-card>
    }

    <p-card styleClass="section">
      <label class="inactive-toggle" for="includeInactive">
        <p-checkbox inputId="includeInactive" [binary]="true" [ngModel]="includeInactive()" (ngModelChange)="toggleInactive($event)" [ngModelOptions]="{ standalone: true }" />
        Mostrar inativos
      </label>
    </p-card>

    @if (loading()) {
      <div class="center"><p-progressSpinner styleClass="spinner-sm" /></div>
    } @else {
      <p-table [value]="courts()" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th>Nome</th>
            <th>Tipo</th>
            <th>Jurisdição</th>
            <th>Status</th>
            @if (canManage()) {
              <th></th>
            }
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-c>
          <tr [class.dim]="!c.active">
            <td>{{ c.name }}</td>
            <td>{{ c.type }}</td>
            <td>{{ c.jurisdiction }}</td>
            <td><p-tag [severity]="c.active ? 'success' : 'secondary'" [value]="c.active ? 'ativo' : 'inativo'" /></td>
            @if (canManage()) {
              <td class="actions">
                <p-button size="small" [text]="true" label="Editar" (onClick)="edit(c)" />
                <p-button size="small" [text]="true" [label]="c.active ? 'Desativar' : 'Ativar'" (onClick)="toggleActive(c)" />
              </td>
            }
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td [attr.colspan]="canManage() ? 5 : 4">Nenhum tribunal cadastrado.</td>
          </tr>
        </ng-template>
      </p-table>
    }
  `,
  styles: [
    `
      .head h1 {
        margin: 0 0 1rem;
        font-size: 1.35rem;
      }
      .section {
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
      :host ::ng-deep .spinner-sm {
        width: 2.5rem;
        height: 2.5rem;
      }
      :host ::ng-deep tr.dim td {
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

  protected readonly types: CourtType[] = [...COURT_TYPES];
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

  protected toggleInactive(checked: boolean): void {
    this.includeInactive.set(checked);
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
