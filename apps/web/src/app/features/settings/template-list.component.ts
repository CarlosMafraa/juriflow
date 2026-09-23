import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  NOTIFICATION_AUDIENCES,
  type MessageTemplate,
  type NotificationAudience,
} from '@juriflow/shared-types';
import { TemplateService } from './template.service';
import { DialogService } from '../../shared/ui/dialog.service';
import { ToastService } from '../../shared/feedback/toast.service';
import { ButtonComponent } from '../../shared/ui/button.component';
import { CardComponent } from '../../shared/ui/card.component';
import { BadgeComponent } from '../../shared/ui/badge.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';

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
    ButtonComponent,
    CardComponent,
    BadgeComponent,
    SpinnerComponent,
    EmptyStateComponent,
  ],
  template: `
    <header class="head"><h1>Templates de mensagem</h1></header>
    <p class="hint">
      Placeholders disponíveis: <code>{{ '{{numero_processo}}' }}</code>,
      <code>{{ '{{movimentacao}}' }}</code>, <code>{{ '{{data}}' }}</code>.
    </p>

    <jf-card [title]="editingId() ? 'Editar template' : 'Novo template'">
      <form class="form" [formGroup]="form" (ngSubmit)="save()">
        <input class="f" placeholder="Nome do template" formControlName="name" />
        <select class="f" formControlName="audience">
          @for (a of audiences; track a) {
            <option [value]="a">{{ audienceLabel(a) }}</option>
          }
        </select>
        <textarea
          class="body"
          rows="4"
          placeholder="Olá! Houve uma nova movimentação no processo {{ '{{numero_processo}}' }}: {{ '{{movimentacao}}' }} (em {{ '{{data}}' }})."
          formControlName="body"
        ></textarea>
        <div class="actions">
          <jf-button type="submit" size="sm" [loading]="saving()">
            {{ editingId() ? 'Salvar' : 'Criar template' }}
          </jf-button>
          @if (editingId()) {
            <jf-button type="button" size="sm" variant="ghost" (click)="resetForm()"
              >Cancelar</jf-button
            >
          }
        </div>
      </form>
    </jf-card>

    @if (loading()) {
      <div class="center"><jf-spinner [showLabel]="true" /></div>
    } @else if (templates().length === 0) {
      <jf-empty-state
        title="Nenhum template cadastrado"
        message="Sem templates, o worker usa a mensagem genérica embutida."
      >
        <span empty-icon>✉️</span>
      </jf-empty-state>
    } @else {
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Audiência</th>
              <th>Corpo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (t of templates(); track t.id) {
              <tr>
                <td>{{ t.name }}</td>
                <td>
                  <jf-badge tone="primary">{{ audienceLabel(t.audience) }}</jf-badge>
                </td>
                <td class="body-cell">{{ t.body }}</td>
                <td class="actions-cell">
                  <jf-button size="sm" variant="ghost" (click)="edit(t)">Editar</jf-button>
                  <jf-button size="sm" variant="ghost" (click)="remove(t)">Excluir</jf-button>
                </td>
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
      jf-card {
        display: block;
        margin-bottom: 1rem;
      }
      .form {
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
        max-width: 34rem;
      }
      .f,
      .body {
        font: inherit;
        padding: 0.5rem 0.7rem;
        border: 1px solid var(--jf-border, #cbd5e1);
        border-radius: var(--jf-radius, 8px);
      }
      .body {
        resize: vertical;
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
        vertical-align: top;
      }
      th {
        background: var(--jf-surface-muted, #f8fafc);
      }
      .body-cell {
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
