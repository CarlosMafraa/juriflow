import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ToastService } from '../../shared/feedback/toast.service';
import { DialogService } from '../../shared/ui/dialog.service';
import { PageHeaderService } from '../../shared/layout/page-header.service';
import { inviteStatus, type InviteStatusView } from '../team/invite-status';
import {
  PlatformAdminService,
  type Plan,
  type PlanInput,
  type PlatformSpace,
  type SpacePlanInput,
} from './platform-admin.service';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type LimitField = 'maxProcesses' | 'maxTrackedProcesses' | 'trackingHoldDays';

/** Linha em branco da tabela de planos (novo plano). */
interface NewPlanRow extends Omit<Plan, 'id'> {
  id: null;
}

const EMPTY_PLAN: PlanInput = {
  name: '',
  maxProcesses: 10,
  maxTrackedProcesses: 3,
  trackingHoldDays: 30,
};

/** Número do campo; vazio = null (na exceção: segue o plano). */
function readNumber(event: Event): number | null {
  const raw = (event.target as HTMLInputElement).value.trim();
  if (raw === '') return null;
  return Math.max(0, Math.floor(Number(raw) || 0));
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
    FormsModule,
    ReactiveFormsModule,
    SelectModule,
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

    <p-card header="Planos" styleClass="section">
      <p class="muted small top">
        Cada escritório segue um plano: limite de processos, de processos com sincronização
        automática e a carência anti-rodízio (dias que a vaga fica presa depois de desligar a
        sincronização). Mudar um plano vale na hora para todos os escritórios dele.
      </p>
      <p-table [value]="planRows()" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th>Plano</th>
            <th>Processos</th>
            <th>Sincronizados</th>
            <th>Carência (dias)</th>
            <th>Escritórios</th>
            <th></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-p>
          @let d = planDraft(p);
          <tr>
            <td>
              <input
                pInputText
                class="name"
                [attr.aria-label]="'Nome do plano ' + (p.name || 'novo')"
                [placeholder]="p.id ? '' : 'Nome do novo plano'"
                [value]="d.name"
                (input)="setPlanName(p, $event)"
              />
              @if (p.isDefault) {
                <p-tag severity="info" value="Padrão" styleClass="default-tag" />
              }
            </td>
            @for (f of limitFields; track f.key) {
              <td>
                <input
                  pInputText
                  class="num"
                  type="number"
                  min="0"
                  [attr.aria-label]="f.label + ' do plano ' + (p.name || 'novo')"
                  [value]="d[f.key]"
                  (input)="setPlanLimit(p, f.key, $event)"
                />
              </td>
            }
            <td>{{ p.id ? p.spacesCount : '—' }}</td>
            <td class="actions">
              <p-button
                size="small"
                [icon]="p.id ? 'pi pi-check' : 'pi pi-plus'"
                [label]="p.id ? 'Salvar' : 'Adicionar plano'"
                [disabled]="!planDirty(p)"
                [loading]="savingPlanId() === (p.id ?? 'new')"
                (onClick)="savePlanRow(p)"
              />
              @if (p.id && !p.isDefault) {
                <p-button
                  size="small"
                  severity="secondary"
                  [outlined]="true"
                  icon="pi pi-trash"
                  label="Excluir"
                  (onClick)="deletePlan(p)"
                />
              }
            </td>
          </tr>
        </ng-template>
      </p-table>
    </p-card>

    <p-card header="Escritórios" styleClass="section">
      @if (loading()) {
        <div class="center"><p-progressSpinner styleClass="spinner-sm" /></div>
      } @else {
        <p class="muted small">
          A plataforma só vê que o escritório existe, o administrador convidado, o status e o plano
          — nunca o conteúdo. Exceção: preencha só o que for diferente do plano (vazio = segue o
          plano).
        </p>
        <p-table [value]="spaces()" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th>Escritório</th>
              <th>Administrador</th>
              <th>Status</th>
              <th>Plano</th>
              <th>Exceção: processos · sincronizados · carência</th>
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
                <p-select
                  [options]="planOptions()"
                  [ngModel]="draft(s).planId"
                  (ngModelChange)="setDraftPlan(s, $event)"
                  [attr.aria-label]="'Plano de ' + label(s)"
                  appendTo="body"
                />
                <div class="muted small effective">
                  Vale: {{ s.maxProcesses }} processos · {{ s.maxTrackedProcesses }} sincronizados ·
                  {{ s.trackingHoldDays }} dias
                  @if (hasOverride(s)) {
                    <p-tag severity="warn" value="Exceção" />
                  }
                </div>
              </td>
              <td class="overrides">
                @for (f of limitFields; track f.key) {
                  <input
                    pInputText
                    class="num"
                    type="number"
                    min="0"
                    [attr.aria-label]="f.label + ' (exceção) de ' + label(s)"
                    [placeholder]="planOf(draft(s).planId)?.[f.key] ?? ''"
                    [value]="draft(s)[f.key] ?? ''"
                    (input)="setDraftLimit(s, f.key, $event)"
                  />
                }
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
      .name {
        width: 12rem;
      }
      :host ::ng-deep .default-tag {
        margin-left: 0.4rem;
      }
      .top {
        margin: 0 0 0.75rem;
      }
      .effective {
        margin: 0.35rem 0 0;
        display: flex;
        align-items: center;
        gap: 0.35rem;
        flex-wrap: wrap;
      }
      .overrides {
        white-space: nowrap;
      }
      .overrides .num + .num {
        margin-left: 0.3rem;
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
  private readonly planDrafts = signal<Record<string, SpacePlanInput>>({});

  protected readonly limitFields: { key: LimitField; label: string }[] = [
    { key: 'maxProcesses', label: 'Processos' },
    { key: 'maxTrackedProcesses', label: 'Sincronizados' },
    { key: 'trackingHoldDays', label: 'Carência (dias)' },
  ];
  protected readonly plans = signal<Plan[]>([]);
  /** Planos existentes + uma linha em branco para criar um novo. */
  protected readonly planRows = computed((): (Plan | NewPlanRow)[] => [
    ...this.plans(),
    { id: null, ...EMPTY_PLAN, isDefault: false, spacesCount: 0 },
  ]);
  protected readonly planOptions = computed(() =>
    this.plans().map((p) => ({ label: p.name, value: p.id })),
  );
  protected readonly savingPlanId = signal<string | null>(null);
  private readonly catalogDrafts = signal<Record<string, PlanInput>>({});

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

  // ---------------------------------------------------------------- catálogo
  protected planOf(id: string): Plan | undefined {
    return this.plans().find((p) => p.id === id);
  }

  protected planDraft(p: Plan | NewPlanRow): PlanInput {
    return (
      this.catalogDrafts()[p.id ?? 'new'] ?? {
        name: p.name,
        maxProcesses: p.maxProcesses,
        maxTrackedProcesses: p.maxTrackedProcesses,
        trackingHoldDays: p.trackingHoldDays,
      }
    );
  }

  protected setPlanName(p: Plan | NewPlanRow, event: Event): void {
    const name = (event.target as HTMLInputElement).value;
    this.catalogDrafts.update((all) => ({
      ...all,
      [p.id ?? 'new']: { ...this.planDraft(p), name },
    }));
  }

  protected setPlanLimit(p: Plan | NewPlanRow, field: LimitField, event: Event): void {
    const value = readNumber(event) ?? 0;
    this.catalogDrafts.update((all) => ({
      ...all,
      [p.id ?? 'new']: { ...this.planDraft(p), [field]: value },
    }));
  }

  protected planDirty(p: Plan | NewPlanRow): boolean {
    const d = this.planDraft(p);
    if (!d.name.trim()) return false;
    return (
      d.name.trim() !== p.name ||
      d.maxProcesses !== p.maxProcesses ||
      d.maxTrackedProcesses !== p.maxTrackedProcesses ||
      d.trackingHoldDays !== p.trackingHoldDays
    );
  }

  protected async savePlanRow(p: Plan | NewPlanRow): Promise<void> {
    const key = p.id ?? 'new';
    this.savingPlanId.set(key);
    try {
      await this.service.savePlan(p.id, this.planDraft(p));
      this.toast.success(
        p.id ? `Plano "${this.planDraft(p).name.trim()}" atualizado.` : 'Plano criado.',
      );
      this.catalogDrafts.update(({ [key]: _, ...rest }) => rest);
      await this.load();
    } catch (err) {
      const message = (err as { message?: string; code?: string }) ?? {};
      this.toast.error(
        message.code === '23505'
          ? 'Já existe um plano com esse nome.'
          : message.code === '23514'
            ? 'Confira os números do plano (carência entre 0 e 365 dias).'
            : 'Não foi possível salvar o plano.',
      );
    } finally {
      this.savingPlanId.set(null);
    }
  }

  protected async deletePlan(p: Plan): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: 'Excluir plano',
      message: `Excluir o plano "${p.name}"?`,
      confirmLabel: 'Excluir',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await this.service.deletePlan(p.id);
      this.toast.success('Plano excluído.');
      await this.load();
    } catch (err) {
      const message = (err as { message?: string; code?: string }) ?? {};
      this.toast.error(
        message.code === '23514' && message.message
          ? message.message
          : 'Não foi possível excluir o plano.',
      );
    }
  }

  // ---------------------------------------------------------------- escritórios
  protected hasOverride(s: PlatformSpace): boolean {
    return (
      s.overrideMaxProcesses !== null ||
      s.overrideMaxTrackedProcesses !== null ||
      s.overrideTrackingHoldDays !== null
    );
  }

  protected draft(s: PlatformSpace): SpacePlanInput {
    return (
      this.planDrafts()[s.id] ?? {
        planId: s.planId,
        maxProcesses: s.overrideMaxProcesses,
        maxTrackedProcesses: s.overrideMaxTrackedProcesses,
        trackingHoldDays: s.overrideTrackingHoldDays,
      }
    );
  }

  protected setDraftPlan(s: PlatformSpace, planId: string): void {
    this.planDrafts.update((all) => ({ ...all, [s.id]: { ...this.draft(s), planId } }));
  }

  protected setDraftLimit(s: PlatformSpace, field: LimitField, event: Event): void {
    const value = readNumber(event);
    this.planDrafts.update((all) => ({ ...all, [s.id]: { ...this.draft(s), [field]: value } }));
  }

  protected planChanged(s: PlatformSpace): boolean {
    const d = this.draft(s);
    return (
      d.planId !== s.planId ||
      d.maxProcesses !== s.overrideMaxProcesses ||
      d.maxTrackedProcesses !== s.overrideMaxTrackedProcesses ||
      d.trackingHoldDays !== s.overrideTrackingHoldDays
    );
  }

  protected async savePlan(s: PlatformSpace): Promise<void> {
    const d = this.draft(s);
    this.savingPlan.set(s.id);
    try {
      await this.service.setSpacePlan(s.id, d);
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
      const [spaces, plans] = await Promise.all([
        this.service.listSpaces(),
        this.service.listPlans(),
      ]);
      this.spaces.set(spaces);
      this.plans.set(plans);
    } catch {
      this.toast.error('Não foi possível carregar os escritórios.');
    } finally {
      this.loading.set(false);
    }
  }
}
