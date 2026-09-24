import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
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
import { PageHeaderService } from '../../shared/layout/page-header.service';

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
    <p class="hint">
      Placeholders disponíveis: <code>{{ '{{numero_processo}}' }}</code>,
      <code>{{ '{{movimentacao}}' }}</code>, <code>{{ '{{data}}' }}</code>.
    </p>

    <div class="editor-grid">
      <p-card [header]="editingId() ? 'Editar template' : 'Novo template'" styleClass="template-card">
        <form class="form" [formGroup]="form" (ngSubmit)="save()">
          <input pInputText class="f" placeholder="Nome do template" formControlName="name" />
          <p-select class="f" [options]="audienceOptions" formControlName="audience" />
          <textarea
            pTextarea
            class="body"
            rows="8"
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

      <!-- Preview: como a mensagem chega no WhatsApp, com os placeholders já
           substituídos por um exemplo — não é envio real, só visual. -->
      <div class="wa-preview">
        <div class="wa-preview__header">
          <span class="wa-preview__avatar"><i class="pi pi-user" aria-hidden="true"></i></span>
          <p class="wa-preview__name">{{ previewAudienceLabel() }}</p>
        </div>
        <div class="wa-preview__chat">
          @if (previewText().trim()) {
            <div class="wa-bubble">
              <p>{{ previewText() }}</p>
              <span class="wa-bubble__meta">
                09:41
                <i class="pi pi-check" aria-hidden="true"></i><i class="pi pi-check" aria-hidden="true"></i>
              </span>
            </div>
          } @else {
            <p class="wa-preview__empty">Digite a mensagem para ver como ela vai aparecer no WhatsApp.</p>
          }
        </div>
      </div>
    </div>

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
      /* As 2 colunas somam 100% da largura sempre (minmax(0,1fr) em vez de
         max-width fixo) — com max-width, formulário+preview não chegavam
         nem perto do fim da tela e sobrava um vão vazio enorme do lado. */
      .editor-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 1.25rem;
        margin-bottom: 1rem;
      }
      @media (max-width: 40rem) {
        .editor-grid {
          grid-template-columns: 1fr;
        }
      }
      /* styleClass do p-card cai num div interno do template do PrimeNG, fora
         do encapsulamento deste componente — precisa de ::ng-deep. */
      :host ::ng-deep .template-card {
        display: block;
        height: 100%;
      }
      .form {
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
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
      /* Preview do WhatsApp: só decorativo (não envia nada), pra dar a
         mesma ideia de like/aparência de um chat real. */
      .wa-preview {
        height: 100%;
        display: flex;
        flex-direction: column;
        border-radius: 1rem;
        overflow: hidden;
        box-shadow: var(--jf-shadow-card);
      }
      .wa-preview__header {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        padding: 0.6rem 0.9rem;
        background: var(--jf-primary, #1f385d);
        color: #fff;
      }
      .wa-preview__avatar {
        width: 2rem;
        height: 2rem;
        border-radius: 999px;
        background: rgb(255 255 255 / 20%);
        display: grid;
        place-items: center;
        font-size: 0.9rem;
      }
      .wa-preview__name {
        margin: 0;
        font-weight: 600;
        font-size: 0.9rem;
      }
      .wa-preview__chat {
        flex: 1;
        min-height: 14rem;
        background: #e5ddd5;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
      }
      .wa-preview__empty {
        margin: 0;
        font-size: 0.8rem;
        color: #667781;
        text-align: center;
      }
      .wa-bubble {
        align-self: flex-end;
        max-width: 88%;
        background: #dcf8c6;
        border-radius: 0.5rem;
        padding: 0.45rem 0.55rem 0.35rem;
        box-shadow: 0 1px 1px rgb(0 0 0 / 10%);
      }
      .wa-bubble p {
        margin: 0;
        font-size: 0.85rem;
        white-space: pre-wrap;
        color: #111b21;
      }
      .wa-bubble__meta {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 0;
        margin-top: 0.15rem;
        font-size: 0.68rem;
        color: #667781;
      }
      .wa-bubble__meta .pi-check {
        font-size: 0.65rem;
        color: #53bdeb;
      }
      .wa-bubble__meta .pi-check + .pi-check {
        margin-left: -0.4rem;
      }
    `,
  ],
})
export class TemplateListComponent {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(TemplateService);
  private readonly dialogs = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly pageHeader = inject(PageHeaderService);

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

  /** Corpo/audiência como signal só pra alimentar o preview reativamente —
      o form em si continua Reactive Forms de verdade (validação, submit). */
  private readonly bodyValue = toSignal(this.form.controls.body.valueChanges, {
    initialValue: this.form.controls.body.value,
  });
  private readonly audienceValue = toSignal(this.form.controls.audience.valueChanges, {
    initialValue: this.form.controls.audience.value,
  });
  protected readonly previewAudienceLabel = computed(() => AUDIENCE_LABEL[this.audienceValue()]);
  protected readonly previewText = computed(() =>
    this.bodyValue()
      .replaceAll('{{numero_processo}}', '0001234-56.2026.8.04.0001')
      .replaceAll('{{movimentacao}}', 'Juntada de petição pelo autor.')
      .replaceAll('{{data}}', '24/09/2026'),
  );

  constructor() {
    this.pageHeader.set('Templates de mensagem');
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
