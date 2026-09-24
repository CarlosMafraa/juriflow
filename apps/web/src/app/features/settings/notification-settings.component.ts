import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { MessageTemplate } from '@juriflow/shared-types';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { CheckboxModule } from 'primeng/checkbox';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { NotificationConfigService } from './notification-config.service';
import { TemplateService } from './template.service';
import { ToastService } from '../../shared/feedback/toast.service';
import { PageHeaderService } from '../../shared/layout/page-header.service';

const NO_TEMPLATE = '';

@Component({
  selector: 'jf-notification-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormsModule,
    ButtonModule,
    CardModule,
    CheckboxModule,
    ProgressSpinnerModule,
    SelectModule,
  ],
  template: `
    <p class="hint">
      Padrão para todos os processos do espaço. Um processo pode ter uma configuração própria que
      prevalece sobre esta — veja a aba de notificações no detalhe do processo. Gerencie o texto das
      mensagens em <a routerLink="/configuracoes/templates">Templates</a>.
    </p>

    @if (loading()) {
      <div class="center"><p-progressSpinner styleClass="spinner-sm" /></div>
    } @else {
      <p-card header="Padrão do espaço">
        <div class="row">
          <label class="chk" for="notifyResponsible">
            <p-checkbox
              inputId="notifyResponsible"
              [binary]="true"
              [ngModel]="notifyResponsible()"
              (ngModelChange)="notifyResponsible.set($event)"
              [ngModelOptions]="{ standalone: true }"
            />
            Notificar o responsável pelo processo
          </label>
          <p-select
            class="f"
            [disabled]="!notifyResponsible()"
            [options]="responsibleOptions()"
            [ngModel]="responsibleTemplateId()"
            (ngModelChange)="responsibleTemplateId.set($event)"
            [ngModelOptions]="{ standalone: true }"
          />
        </div>

        <div class="row">
          <label class="chk" for="notifyClients">
            <p-checkbox
              inputId="notifyClients"
              [binary]="true"
              [ngModel]="notifyClients()"
              (ngModelChange)="notifyClients.set($event)"
              [ngModelOptions]="{ standalone: true }"
            />
            Notificar os clientes vinculados
          </label>
          <p-select
            class="f"
            [disabled]="!notifyClients()"
            [options]="clientOptions()"
            [ngModel]="clientTemplateId()"
            (ngModelChange)="clientTemplateId.set($event)"
            [ngModelOptions]="{ standalone: true }"
          />
        </div>

        <div class="actions">
          <p-button size="small" icon="pi pi-check" (onClick)="save()" [loading]="saving()" label="Salvar" />
        </div>
      </p-card>
    }
  `,
  styles: [
    `
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
      :host ::ng-deep .spinner-sm {
        width: 2.5rem;
        height: 2.5rem;
      }
      /* Página de uma seção só — o card é o painel da própria página, sem
         disputar espaço com outros cards ao lado, então vai até o final. */
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
        flex: 1;
        min-width: 14rem;
        max-width: 28rem;
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
  private readonly pageHeader = inject(PageHeaderService);

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
  protected readonly responsibleOptions = computed(() => [
    { label: 'Mensagem genérica embutida', value: NO_TEMPLATE },
    ...this.responsibleTemplates().map((t) => ({ label: t.name, value: t.id })),
  ]);
  protected readonly clientOptions = computed(() => [
    { label: 'Mensagem genérica embutida', value: NO_TEMPLATE },
    ...this.clientTemplates().map((t) => ({ label: t.name, value: t.id })),
  ]);

  constructor() {
    this.pageHeader.set('Regras de notificação');
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
