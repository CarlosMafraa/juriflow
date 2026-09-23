import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { MessageTemplate } from '@juriflow/shared-types';
import { NotificationConfigService } from './notification-config.service';
import { TemplateService } from './template.service';
import { ToastService } from '../../shared/feedback/toast.service';
import { ButtonComponent } from '../../shared/ui/button.component';
import { CardComponent } from '../../shared/ui/card.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';

const NO_TEMPLATE = '';

@Component({
  selector: 'jf-notification-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ButtonComponent, CardComponent, SpinnerComponent],
  template: `
    <header class="head"><h1>Regras de notificação</h1></header>
    <p class="hint">
      Padrão para todos os processos do espaço. Um processo pode ter uma configuração própria que
      prevalece sobre esta — veja a aba de notificações no detalhe do processo. Gerencie o texto das
      mensagens em <a routerLink="/configuracoes/templates">Templates</a>.
    </p>

    @if (loading()) {
      <div class="center"><jf-spinner [showLabel]="true" /></div>
    } @else {
      <jf-card title="Padrão do espaço">
        <div class="row">
          <label class="chk">
            <input
              type="checkbox"
              [checked]="notifyResponsible()"
              (change)="notifyResponsible.set($any($event.target).checked)"
            />
            Notificar o responsável pelo processo
          </label>
          <select
            class="f"
            [disabled]="!notifyResponsible()"
            (change)="responsibleTemplateId.set($any($event.target).value)"
          >
            <option [value]="noTemplate" [selected]="responsibleTemplateId() === noTemplate">
              Mensagem genérica embutida
            </option>
            @for (t of responsibleTemplates(); track t.id) {
              <option [value]="t.id" [selected]="t.id === responsibleTemplateId()">
                {{ t.name }}
              </option>
            }
          </select>
        </div>

        <div class="row">
          <label class="chk">
            <input
              type="checkbox"
              [checked]="notifyClients()"
              (change)="notifyClients.set($any($event.target).checked)"
            />
            Notificar os clientes vinculados
          </label>
          <select
            class="f"
            [disabled]="!notifyClients()"
            (change)="clientTemplateId.set($any($event.target).value)"
          >
            <option [value]="noTemplate" [selected]="clientTemplateId() === noTemplate">
              Mensagem genérica embutida
            </option>
            @for (t of clientTemplates(); track t.id) {
              <option [value]="t.id" [selected]="t.id === clientTemplateId()">{{ t.name }}</option>
            }
          </select>
        </div>

        <div class="actions">
          <jf-button (click)="save()" [loading]="saving()">Salvar</jf-button>
        </div>
      </jf-card>
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
        max-width: 40rem;
      }
      .center {
        display: flex;
        justify-content: center;
        padding: 2.5rem;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 0;
        border-bottom: 1px solid var(--jf-border, #e2e8f0);
      }
      .chk {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.9rem;
        min-width: 16rem;
      }
      .f {
        font: inherit;
        padding: 0.4rem 0.6rem;
        border: 1px solid var(--jf-border, #cbd5e1);
        border-radius: var(--jf-radius, 8px);
        min-width: 14rem;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        padding-top: 1rem;
      }
    `,
  ],
})
export class NotificationSettingsComponent {
  private readonly configService = inject(NotificationConfigService);
  private readonly templateService = inject(TemplateService);
  private readonly toast = inject(ToastService);

  protected readonly noTemplate = NO_TEMPLATE;
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);

  protected readonly notifyResponsible = signal(true);
  protected readonly notifyClients = signal(true);
  protected readonly responsibleTemplateId = signal<string>(NO_TEMPLATE);
  protected readonly clientTemplateId = signal<string>(NO_TEMPLATE);

  private readonly templates = signal<MessageTemplate[]>([]);
  protected readonly responsibleTemplates = computed(() =>
    this.templates().filter((t) => t.audience === 'responsible'),
  );
  protected readonly clientTemplates = computed(() =>
    this.templates().filter((t) => t.audience === 'client'),
  );

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [config, templates] = await Promise.all([
        this.configService.getForSpace(),
        this.templateService.list(),
      ]);
      this.templates.set(templates);
      if (config) {
        this.notifyResponsible.set(config.notifyResponsible);
        this.notifyClients.set(config.notifyClients);
        this.responsibleTemplateId.set(config.responsibleTemplateId ?? NO_TEMPLATE);
        this.clientTemplateId.set(config.clientTemplateId ?? NO_TEMPLATE);
      }
    } catch {
      this.toast.error('Não foi possível carregar a configuração de notificações.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    try {
      await this.configService.upsertForSpace({
        notifyResponsible: this.notifyResponsible(),
        notifyClients: this.notifyClients(),
        responsibleTemplateId: this.responsibleTemplateId() || null,
        clientTemplateId: this.clientTemplateId() || null,
      });
      this.toast.success('Configuração salva.');
    } catch {
      this.toast.error('Não foi possível salvar a configuração.');
    } finally {
      this.saving.set(false);
    }
  }
}
