import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  DEFAULT_BIRTHDAY_TEMPLATES,
  DEFAULT_MESSAGE_TEMPLATE,
  type MessageTemplate,
  type NotificationAudience,
  type TemplateKind,
} from '@juriflow/shared-types';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { TemplateService } from './template.service';
import { WhatsappPreviewComponent, renderMessagePreview } from './whatsapp-preview.component';
import { DialogService } from '../../shared/ui/dialog.service';
import { ToastService } from '../../shared/feedback/toast.service';
import { PageHeaderService } from '../../shared/layout/page-header.service';

type TemplateRow =
  | (MessageTemplate & { builtin: false })
  | { builtin: true; name: string; body: string; audience: NotificationAudience | 'both' };

const AUDIENCE_LABEL: Record<NotificationAudience | 'both', string> = {
  responsible: 'Responsável',
  client: 'Cliente',
  team: 'Equipe do escritório',
  both: 'Responsável e cliente',
};

/** Públicos de cada tipo de template (mesma regra da constraint do banco). */
const KIND_AUDIENCES: Record<TemplateKind, NotificationAudience[]> = {
  movement: ['responsible', 'client'],
  birthday: ['team', 'client'],
};

const KIND_PLACEHOLDERS: Record<TemplateKind, string[]> = {
  movement: ['{{numero_processo}}', '{{movimentacao}}', '{{data}}'],
  birthday: ['{{nome}}', '{{escritorio}}'],
};

const BUILTIN_ROWS: Record<TemplateKind, TemplateRow[]> = {
  movement: [
    {
      builtin: true,
      name: DEFAULT_MESSAGE_TEMPLATE.name,
      body: DEFAULT_MESSAGE_TEMPLATE.body,
      audience: 'both',
    },
  ],
  birthday: (['team', 'client'] as const).map((audience) => ({
    builtin: true as const,
    name: DEFAULT_BIRTHDAY_TEMPLATES[audience].name,
    body: DEFAULT_BIRTHDAY_TEMPLATES[audience].body,
    audience,
  })),
};

@Component({
  selector: 'jf-template-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    SelectButtonModule,
    ButtonModule,
    CardModule,
    InputTextModule,
    ProgressSpinnerModule,
    SelectModule,
    TableModule,
    TagModule,
    TextareaModule,
    WhatsappPreviewComponent,
  ],
  template: `
    <div class="kinds">
      <p-selectButton
        [options]="kindOptions"
        [ngModel]="kind()"
        (ngModelChange)="selectKind($event)"
        [allowEmpty]="false"
        optionLabel="label"
        optionValue="value"
        aria-label="Tipo de template"
      />
    </div>
    <p class="hint">
      @if (kind() === 'birthday') {
        Enviado no dia do aniversário, às 9h (horário de Manaus), para a equipe e para os clientes
        que aceitam avisos. Escolha qual template vale em Regras de notificação.
      }
      Placeholders disponíveis:
      @for (p of placeholders(); track p; let last = $last) {
        <code>{{ p }}</code
        >{{ last ? '.' : ',' }}
      }
    </p>

    <div class="editor-grid">
      <p-card
        [header]="editingId() ? 'Editar template' : 'Novo template'"
        styleClass="template-card"
      >
        <form class="form" [formGroup]="form" (ngSubmit)="save()">
          <input pInputText class="f" placeholder="Nome do template" formControlName="name" />
          <p-select class="f" [options]="audienceOptions()" formControlName="audience" />
          <textarea
            pTextarea
            class="body"
            rows="8"
            [placeholder]="bodyPlaceholder()"
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
              <p-button
                type="button"
                size="small"
                severity="secondary"
                [text]="true"
                icon="pi pi-times"
                label="Cancelar"
                (onClick)="resetForm()"
              />
            }
          </div>
        </form>
      </p-card>

      <jf-whatsapp-preview [title]="previewAudienceLabel()" [text]="previewText()" />
    </div>

    @if (loading()) {
      <div class="center"><p-progressSpinner styleClass="spinner-sm" /></div>
    } @else {
      <p-table [value]="rows()" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th>Nome</th>
            <th>Audiência</th>
            <th>Corpo</th>
            <th></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-t>
          @if (t.builtin) {
            <tr class="builtin-row">
              <td>
                {{ t.name }}
                <small class="builtin-hint"
                  >Vale quando o processo e o escritório não escolhem um template.</small
                >
              </td>
              <td class="tags-cell">
                <p-tag severity="secondary" [value]="audienceLabel(t.audience)" />
              </td>
              <td class="body-cell">{{ t.body }}</td>
              <td>
                <div class="actions-cell">
                  <p-button
                    size="small"
                    [text]="true"
                    icon="pi pi-copy"
                    label="Usar como base"
                    (onClick)="useAsBase(t)"
                  />
                </div>
              </td>
            </tr>
          } @else {
            <tr>
              <td>{{ t.name }}</td>
              <td><p-tag severity="info" [value]="audienceLabel(t.audience)" /></td>
              <td class="body-cell">{{ t.body }}</td>
              <td>
                <div class="actions-cell">
                  <p-button
                    size="small"
                    [text]="true"
                    icon="pi pi-pencil"
                    label="Editar"
                    (onClick)="edit(t)"
                  />
                  <p-button
                    size="small"
                    [text]="true"
                    icon="pi pi-trash"
                    label="Excluir"
                    (onClick)="remove(t)"
                  />
                </div>
              </td>
            </tr>
          }
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
      .builtin-row td {
        background: var(--jf-surface-muted, #f8fafc);
      }
      .builtin-hint {
        display: block;
        margin-top: 0.2rem;
        font-size: 0.75rem;
        color: var(--jf-text-muted, #64748b);
      }
      .kinds {
        margin-bottom: 0.75rem;
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

  protected readonly kindOptions = [
    { label: 'Movimentação', value: 'movement' as TemplateKind },
    { label: 'Aniversário', value: 'birthday' as TemplateKind },
  ];
  protected readonly kind = signal<TemplateKind>('movement');
  protected readonly audienceOptions = computed(() =>
    KIND_AUDIENCES[this.kind()].map((a) => ({ label: AUDIENCE_LABEL[a], value: a })),
  );
  protected readonly placeholders = computed(() => KIND_PLACEHOLDERS[this.kind()]);
  protected readonly bodyPlaceholder = computed(() =>
    this.kind() === 'birthday'
      ? 'Feliz aniversário, {{nome}}! O {{escritorio}} deseja um dia incrível.'
      : 'Olá! Houve uma nova movimentação no processo {{numero_processo}}: {{movimentacao}} (em {{data}}).',
  );
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
  protected readonly previewText = computed(() => renderMessagePreview(this.bodyValue()));

  /** O padrão do sistema entra na lista (só leitura) para todo mundo saber o que é enviado. */
  protected readonly rows = computed((): TemplateRow[] => [
    ...BUILTIN_ROWS[this.kind()],
    ...this.templates()
      .filter((t) => t.kind === this.kind())
      .map((t) => ({ ...t, builtin: false as const })),
  ]);

  constructor() {
    this.pageHeader.set('Templates de mensagem');
    void this.load();
  }

  protected audienceLabel(a: NotificationAudience | 'both'): string {
    return AUDIENCE_LABEL[a];
  }

  protected selectKind(kind: TemplateKind): void {
    if (!kind || kind === this.kind()) return;
    this.kind.set(kind);
    this.resetForm();
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

  protected useAsBase(row: TemplateRow): void {
    this.editingId.set(null);
    const audience =
      row.audience === 'both'
        ? KIND_AUDIENCES[this.kind()][0]
        : (row.audience as NotificationAudience);
    this.form.patchValue({ name: '', audience, body: row.body });
  }

  protected resetForm(): void {
    this.editingId.set(null);
    this.form.reset({ name: '', audience: KIND_AUDIENCES[this.kind()][0], body: '' });
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    try {
      const v = { ...this.form.getRawValue(), kind: this.kind() };
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
      message: `Excluir "${t.name}"? Configurações que usam este template passam a usar o padrão do sistema.`,
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
