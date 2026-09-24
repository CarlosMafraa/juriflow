import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  NOTIFICATION_AUDIENCES,
  type MessageTemplate,
  type NotificationAudience,
} from '@juriflow/shared-types';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { TemplateService } from './template.service';
import { DialogService } from '../../shared/ui/dialog.service';
import { ToastService } from '../../shared/feedback/toast.service';

const AUDIENCE_LABEL: Record<NotificationAudience, string> = {
  responsible: 'Responsável',
  client: 'Cliente',
};

@Component({
  selector: 'jf-template-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    CardModule,
    InputTextModule,
    ProgressSpinnerModule,
    SelectModule,
    TableModule,
    TagModule,
    TextareaModule,
  ],
  template: `
    <header class="head"><h1>Templates de mensagem</h1></header>
    <p class="hint">
      Placeholders disponíveis: <code>{{ '{{numero_processo}}' }}</code>,
      <code>{{ '{{movimentacao}}' }}</code>, <code>{{ '{{data}}' }}</code>.
    </p>

    <p-card [header]="editingId() ? 'Editar template' : 'Novo template'" styleClass="section">
      <form class="form" [formGroup]="form" (ngSubmit)="save()">
        <input pInputText class="f" placeholder="Nome do template" formControlName="name" />
        <p-select class="f" [options]="audienceOptions" formControlName="audience" />
        <textarea
          pTextarea
          class="body"
          rows="4"
          placeholder="Olá! Houve uma nova movimentação no processo {{ '{{numero_processo}}' }}: {{ '{{movimentacao}}' }} (em {{ '{{data}}' }})."
          formControlName="body"
        ></textarea>
        <div class="actions">
          <p-button
            type="submit"
            size="small"
            [icon]="editingId() ? 'pi pi-check' : 'pi pi-plus'"
            [loading]="saving()"
            [label]="editingId() ? 'Salvar' : 'Criar template'"
          />
          @if (editingId()) {
            <p-button type="button" size="small" severity="secondary" [text]="true" icon="pi pi-times" label="Cancelar" (onClick)="resetForm()" />
          }
        </div>
      </form>
    </p-card>

    @if (loading()) {
      <div class="center"><p-progressSpinner styleClass="spinner-sm" /></div>
    } @else {
      <p-table [value]="templates()" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th>Nome</th>
            <th>Audiência</th>
            <th>Corpo</th>
            <th></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-t>
          <tr>
            <td>{{ t.name }}</td>
            <td><p-tag severity="info" [value]="audienceLabel(t.audience)" /></td>
            <td class="body-cell">{{ t.body }}</td>
            <td class="actions-cell">
              <p-button size="small" [text]="true" icon="pi pi-pencil" label="Editar" (onClick)="edit(t)" />
              <p-button size="small" [text]="true" icon="pi pi-trash" label="Excluir" (onClick)="remove(t)" />
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="4">Nenhum template cadastrado. Sem templates, o worker usa a mensagem genérica embutida.</td>
          </tr>
        </ng-template>
      </p-table>
    }
  `,
  styles: [
    `
      .head h1 {
        margin: 0 0 0.35rem;
        font-size: 1.35rem;
      }
      .hint {
        margin: 0 0 1rem;
        font-size: 0.8125rem;
        color: var(--jf-text-muted, #64748b);
      }
      .hint code {
        background: var(--jf-surface-muted, #f1f5f9);
        padding: 0.1rem 0.35rem;
        border-radius: 4px;
      }
      .section {
        display: block;
        margin-bottom: 1rem;
      }
      .form {
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
        max-width: 34rem;
      }
      .body {
        resize: vertical;
        width: 100%;
      }
      .actions {
        display: flex;
        gap: 0.5rem;
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
      :host ::ng-deep .body-cell {
        max-width: 26rem;
        white-space: pre-wrap;
        color: var(--jf-text-muted, #475569);
      }
      .actions-cell {
        display: flex;
        gap: 0.25rem;
        white-space: nowrap;
      }
    `,
  ],
})
export class TemplateListComponent {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(TemplateService);
  private readonly dialogs = inject(DialogService);
  private readonly toast = inject(ToastService);

  protected readonly audiences = NOTIFICATION_AUDIENCES;
  protected readonly audienceOptions = NOTIFICATION_AUDIENCES.map((a) => ({
    label: AUDIENCE_LABEL[a],
    value: a,
  }));
  protected readonly loading = signal(true);
  protected readonly templates = signal<MessageTemplate[]>([]);
  protected readonly saving = signal(false);
  protected readonly editingId = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required]],
    audience: 'responsible' as NotificationAudience,
    body: ['', [Validators.required]],
  });

  constructor() {
    void this.load();
  }

  protected audienceLabel(a: NotificationAudience): string {
    return AUDIENCE_LABEL[a];
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.templates.set(await this.service.list());
    } catch {
      this.toast.error('Não foi possível carregar os templates.');
    } finally {
      this.loading.set(false);
    }
  }

  protected edit(t: MessageTemplate): void {
    this.editingId.set(t.id);
    this.form.setValue({ name: t.name, audience: t.audience, body: t.body });
  }

  protected resetForm(): void {
    this.editingId.set(null);
    this.form.reset({ name: '', audience: 'responsible', body: '' });
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
        this.toast.success('Template atualizado.');
      } else {
        await this.service.create(v);
        this.toast.success('Template criado.');
      }
      this.resetForm();
      await this.load();
    } catch {
      this.toast.error('Não foi possível salvar o template.');
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(t: MessageTemplate): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: 'Excluir template',
      message: `Excluir "${t.name}"? Configurações que usam este template passam a usar a mensagem genérica embutida.`,
      confirmLabel: 'Excluir',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await this.service.remove(t.id);
      this.toast.success('Template excluído.');
      await this.load();
    } catch {
      this.toast.error('Não foi possível excluir o template.');
    }
  }
}
