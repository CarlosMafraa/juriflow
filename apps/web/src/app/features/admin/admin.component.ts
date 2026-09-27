import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ToastService } from '../../shared/feedback/toast.service';
import { DialogService } from '../../shared/ui/dialog.service';
import { PageHeaderService } from '../../shared/layout/page-header.service';
import { inviteStatus, type InviteStatusView } from '../team/invite-status';
import { PlatformAdminService, type PlatformSpace } from './platform-admin.service';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface PlanDraft {
  maxProcesses: number;
  maxTrackedProcesses: number;
}

/**
 * Administração da plataforma. Responsabilidade do SUPER_ADMIN: criar
 * escritórios (convidando o ADMIN de cada um), suspender/reativar e definir o
 * plano. Do escritório ele só vê o que é "de fora".
 */
@Component({
  selector: 'jf-admin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    CardModule,
    InputTextModule,
    ProgressSpinnerModule,
    TableModule,
    TagModule,
  ],
  template: `
    <p-card header="Novo escritório" styleClass="section">
      <form class="create-form" [formGroup]="form" (ngSubmit)="createOffice()">
        <div class="field grow">
          <label for="adminEmail">E-mail do administrador do escritório</label>
          <input
            pInputText
            id="adminEmail"
            type="email"
            formControlName="adminEmail"
            placeholder="advogado@escritorio.com.br"
          />
        </div>
        <p-button
          type="submit"
          size="small"
          icon="pi pi-send"
          [loading]="creating()"
          label="Enviar convite"
        />
      </form>
      <p class="muted small">
        O escritório é criado aguardando configuração. O administrador recebe um link (vale 24
        horas), completa os dados dele e do escritório e depois convida a própria equipe. Reenviar o
        convite invalida o link anterior.
      </p>
    </p-card>

    <p-card header="Escritórios" styleClass="section">
      @if (loading()) {
        <div class="center"><p-progressSpinner styleClass="spinner-sm" /></div>
      } @else {
        <p class="muted small">
          A plataforma só vê que o escritório existe, o administrador convidado, o status e o plano
          — nunca o conteúdo.
        </p>
        <p-table [value]="spaces()" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th>Escritório</th>
              <th>Administrador</th>
              <th>Status</th>
              <th>Processos</th>
              <th>Sincronizados</th>
              <th></th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-s>
            <tr>
              <td>
                @if (s.setupCompletedAt) {
                  <strong>{{ s.name }}</strong>
                } @else {
                  <p-tag severity="info" value="Aguardando configuração" />
                }
              </td>
              <td>
                <div class="admin">{{ s.adminEmail || '—' }}</div>
                @if (!s.setupCompletedAt) {
                  @let inv = invite(s);
                  <div class="invite">
                    <p-tag [severity]="inv.severity" [value]="inv.label" />
                    @if (inv.detail) {
                      <span class="muted small">{{ inv.detail }}</span>
                    }
                  </div>
                }
              </td>
              <td>
                <p-tag
                  [severity]="s.status === 'active' ? 'success' : 'danger'"
                  [value]="s.status === 'active' ? 'Ativo' : 'Suspenso'"
                />
              </td>
              <td>
                <input
                  pInputText
                  class="num"
                  type="number"
                  min="0"
                  [attr.aria-label]="'Limite de processos de ' + label(s)"
                  [value]="draft(s).maxProcesses"
                  (input)="setDraft(s, 'maxProcesses', $event)"
                />
              </td>
              <td>
                <input
                  pInputText
                  class="num"
                  type="number"
                  min="0"
                  [attr.aria-label]="'Limite de sincronizados de ' + label(s)"
                  [value]="draft(s).maxTrackedProcesses"
                  (input)="setDraft(s, 'maxTrackedProcesses', $event)"
                />
              </td>
              <td class="actions">
                <p-button
                  size="small"
                  icon="pi pi-check"
                  label="Salvar plano"
                  [disabled]="!planChanged(s)"
                  [loading]="savingPlan() === s.id"
                  (onClick)="savePlan(s)"
                />
                @if (!s.setupCompletedAt && s.inviteId && invite(s).canResend) {
                  <p-button
                    size="small"
                    severity="secondary"
                    [outlined]="true"
                    icon="pi pi-refresh"
                    label="Reenviar convite"
                    [loading]="resending() === s.id"
                    (onClick)="resend(s)"
                  />
                }
                <p-button
                  size="small"
                  severity="secondary"
                  [outlined]="true"
                  [icon]="s.status === 'active' ? 'pi pi-ban' : 'pi pi-refresh'"
                  [label]="s.status === 'active' ? 'Suspender' : 'Reativar'"
                  (onClick)="toggleStatus(s)"
                />
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="6">Nenhum escritório ainda. Convide o primeiro acima.</td>
            </tr>
          </ng-template>
        </p-table>
      }
    </p-card>
  `,
  styles: [
    `
      :host ::ng-deep .section {
        display: block;
        margin-bottom: 1rem;
      }
      .create-form {
        display: flex;
        align-items: flex-end;
        gap: 0.75rem;
        flex-wrap: wrap;
      }
      .grow {
        flex: 1 1 18rem;
      }
      .grow input {
        width: 100%;
      }
      .muted {
        color: var(--jf-text-muted, #64748b);
      }
      .small {
        font-size: 0.8rem;
        margin: 0.75rem 0 0;
      }
      .center {
        display: flex;
        justify-content: center;
        padding: 2rem;
      }
      :host ::ng-deep .spinner-sm {
        width: 2.5rem;
        height: 2.5rem;
      }
      .admin {
        overflow-wrap: anywhere;
      }
      .invite {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        flex-wrap: wrap;
        margin-top: 0.3rem;
      }
      .invite .small {
        margin: 0;
      }
      .num {
        width: 5.5rem;
      }
      .actions {
        white-space: nowrap;
        text-align: right;
      }
      .actions p-button {
        margin-left: 0.35rem;
      }
    `,
  ],
})
export class AdminComponent {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(PlatformAdminService);
  private readonly toast = inject(ToastService);
  private readonly dialogs = inject(DialogService);

  protected readonly loading = signal(true);
  protected readonly creating = signal(false);
  protected readonly resending = signal<string | null>(null);
  protected readonly savingPlan = signal<string | null>(null);
  protected readonly spaces = signal<PlatformSpace[]>([]);
  private readonly planDrafts = signal<Record<string, PlanDraft>>({});

  protected readonly form = this.fb.nonNullable.group({ adminEmail: '' });

  constructor() {
    inject(PageHeaderService).set(
      'Administração da plataforma',
      'Escritórios, status e planos — sem acesso ao conteúdo de cada escritório.',
    );
    void this.load();
  }

  protected label(s: PlatformSpace): string {
    return s.setupCompletedAt ? s.name : (s.adminEmail ?? 'escritório novo');
  }

  protected invite(s: PlatformSpace): InviteStatusView {
    return inviteStatus(s.inviteState, s.inviteSentAt, s.inviteExpiresAt, s.inviteOpenedAt);
  }

  protected async createOffice(): Promise<void> {
    const email = this.form.getRawValue().adminEmail.trim().toLowerCase();
    if (!EMAIL.test(email)) {
      this.toast.error('Informe um e-mail válido.');
      return;
    }
    this.creating.set(true);
    try {
      const sent = await this.service.createOffice(email);
      if (sent) this.toast.success(`Convite enviado para ${email}. O link vale 24 horas.`);
      else
        this.toast.warning(
          'Escritório criado, mas o e-mail não saiu. Use "Reenviar convite" na lista.',
        );
      this.form.reset({ adminEmail: '' });
      await this.load();
    } catch (err) {
      const message = (err as { message?: string })?.message ?? '';
      this.toast.error(
        message.includes('não pode ser ADMIN')
          ? 'A conta da plataforma não pode ser administradora de um escritório.'
          : 'Não foi possível criar o escritório.',
      );
    } finally {
      this.creating.set(false);
    }
  }

  protected async resend(s: PlatformSpace): Promise<void> {
    if (!s.inviteId) return;
    this.resending.set(s.id);
    try {
      const sent = await this.service.resendOfficeInvite(s.inviteId);
      if (sent) this.toast.success('Convite reenviado. O link anterior não funciona mais.');
      else this.toast.warning('Convite renovado, mas o e-mail não saiu. Tente de novo.');
      await this.load();
    } catch {
      this.toast.error('Não foi possível reenviar o convite.');
    } finally {
      this.resending.set(null);
    }
  }

  protected draft(s: PlatformSpace): PlanDraft {
    return (
      this.planDrafts()[s.id] ?? {
        maxProcesses: s.maxProcesses,
        maxTrackedProcesses: s.maxTrackedProcesses,
      }
    );
  }

  protected setDraft(s: PlatformSpace, field: keyof PlanDraft, event: Event): void {
    const value = Math.max(0, Math.floor(Number((event.target as HTMLInputElement).value) || 0));
    this.planDrafts.update((all) => ({ ...all, [s.id]: { ...this.draft(s), [field]: value } }));
  }

  protected planChanged(s: PlatformSpace): boolean {
    const d = this.draft(s);
    return d.maxProcesses !== s.maxProcesses || d.maxTrackedProcesses !== s.maxTrackedProcesses;
  }

  protected async savePlan(s: PlatformSpace): Promise<void> {
    const d = this.draft(s);
    this.savingPlan.set(s.id);
    try {
      await this.service.updatePlan(s.id, d.maxProcesses, d.maxTrackedProcesses);
      this.toast.success(`Plano de "${this.label(s)}" atualizado.`);
      this.planDrafts.update(({ [s.id]: _, ...rest }) => rest);
      await this.load();
    } catch {
      this.toast.error('Não foi possível atualizar o plano.');
    } finally {
      this.savingPlan.set(null);
    }
  }

  protected async toggleStatus(s: PlatformSpace): Promise<void> {
    const next = s.status === 'active' ? 'suspended' : 'active';
    if (next === 'suspended') {
      const confirmed = await this.dialogs.confirm({
        title: 'Suspender escritório',
        message: `Ninguém de "${this.label(s)}" vai conseguir acessar o sistema e a coleta automática para até reativar. Confirma?`,
        confirmLabel: 'Suspender',
        tone: 'danger',
      });
      if (!confirmed) return;
    }
    try {
      await this.service.setSpaceStatus(s.id, next);
      this.toast.success(next === 'suspended' ? 'Espaço suspenso.' : 'Espaço reativado.');
      await this.load();
    } catch {
      this.toast.error('Não foi possível atualizar o status do escritório.');
    }
  }

  private async load(): Promise<void> {
    try {
      this.spaces.set(await this.service.listSpaces());
    } catch {
      this.toast.error('Não foi possível carregar os escritórios.');
    } finally {
      this.loading.set(false);
    }
  }
}
