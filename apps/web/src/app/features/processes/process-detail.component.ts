import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { Client, MessageTemplate } from '@juriflow/shared-types';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import {
  ProcessService,
  type HistoryRow,
  type LinkedClient,
  type MovementRow,
  type ProcessDetail,
} from './process.service';
import { ClientService } from '../clients/client.service';
import { NotificationConfigService } from '../settings/notification-config.service';
import { TemplateService } from '../settings/template.service';
import { SpaceMembersService, type SpaceMemberOption } from '../../core/data/space-members.service';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';
import { AuthService } from '../../core/auth/auth.service';
import { PermissionService } from '../../core/authorization/permission.service';
import { DialogService } from '../../shared/ui/dialog.service';
import { ToastService } from '../../shared/feedback/toast.service';
import { PageHeaderActionsDirective } from '../../shared/layout/page-header-actions.directive';
import { PageHeaderService } from '../../shared/layout/page-header.service';

@Component({
  selector: 'jf-process-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    RouterLink,
    ButtonModule,
    CardModule,
    CheckboxModule,
    InputTextModule,
    MessageModule,
    ProgressSpinnerModule,
    SelectModule,
    TableModule,
    TagModule,
    PageHeaderActionsDirective,
  ],
  template: `
    <ng-template jfPageHeaderActions>
      @if (process(); as p) {
        @if (canEdit() && p.status !== 'closed') {
          @if (p.status === 'active') {
            <p-button size="small" severity="secondary" [outlined]="true" icon="pi pi-inbox" label="Arquivar" (onClick)="setStatus('archived')" />
          } @else {
            <p-button size="small" severity="secondary" [outlined]="true" icon="pi pi-refresh" label="Reativar" (onClick)="setStatus('active')" />
          }
        }
        @if (isAdmin()) {
          @if (p.status !== 'closed') {
            <p-button size="small" severity="secondary" [outlined]="true" icon="pi pi-lock" label="Encerrar" (onClick)="setStatus('closed')" />
          } @else {
            <p-button size="small" severity="secondary" [outlined]="true" icon="pi pi-lock-open" label="Reabrir" (onClick)="setStatus('active')" />
          }
        }
        @if (canEdit()) {
          <p-button size="small" severity="danger" icon="pi pi-trash" label="Excluir" (onClick)="remove()" />
        }
      }
    </ng-template>

    @if (loading()) {
      <div class="center"><p-progressSpinner styleClass="spinner-sm" /></div>
    } @else if (!process()) {
      <p-message severity="warn" styleClass="w-full">
        Processo não encontrado. Ele pode ter sido transferido, arquivado ou você não tem acesso.
      </p-message>
      <a routerLink="/processos"><p-button size="small" severity="secondary" [outlined]="true" icon="pi pi-arrow-left" label="Voltar" styleClass="back-btn" /></a>
    } @else {
      @if (msg()) {
        <p-message [severity]="msg()!.tone" [text]="msg()!.text" styleClass="w-full section" />
      }

      <p-card header="Dados" styleClass="section">
        <form [formGroup]="coreForm" (ngSubmit)="saveCore()" class="core">
          <div class="field">
            <label for="cnjNumber">Número CNJ</label>
            <input pInputText id="cnjNumber" formControlName="cnjNumber" [readonly]="!canEdit()" placeholder="—" />
          </div>
          <div class="field">
            <label for="internalRef">Referência interna</label>
            <input pInputText id="internalRef" formControlName="internalRef" [readonly]="!canEdit()" placeholder="—" />
          </div>
          <div class="ro">
            <span>Tribunal</span><strong>{{ process()!.courtName }}</strong>
          </div>
          <div class="ro">
            <span>Responsável atual</span><strong>{{ process()!.assignedName }}</strong>
          </div>
          <div class="ro">
            <span>Cadastrado por</span><strong>{{ process()!.creatorName }}</strong>
          </div>
          @if (canEdit()) {
            <div class="core-actions field--full">
              <p-button type="submit" size="small" icon="pi pi-check" label="Salvar dados" [loading]="savingCore()" />
            </div>
          }
        </form>
      </p-card>

      <p-card header="Movimentações" styleClass="section">
        @if (movementsLoading()) {
          <div class="center"><p-progressSpinner styleClass="spinner-sm" /></div>
        } @else if (movements().length === 0) {
          <p class="muted">
            Nenhuma movimentação coletada. A coleta automática roda diariamente. Movimentações
            aparecem aqui assim que forem encontradas.
          </p>
        } @else {
          <ol class="movements">
            @for (m of movements(); track m.id) {
              <li>
                <div class="movements__meta">
                  <span class="movements__date">{{
                    m.occurredAt ? fmt(m.occurredAt) : 'Sem data'
                  }}</span>
                  <p-tag severity="secondary" [value]="sourceLabel(m.sourceKind)" />
                </div>
                <p class="movements__desc">{{ m.description }}</p>
                <span class="movements__collected">coletado em {{ fmt(m.collectedAt) }}</span>
              </li>
            }
          </ol>
        }
      </p-card>

      <p-card header="Clientes vinculados" styleClass="section">
        @if (clients().length === 0) {
          <p class="muted">Nenhum cliente vinculado.</p>
        } @else {
          <ul class="linked">
            @for (c of clients(); track c.linkId) {
              <li>
                <a [routerLink]="['/clientes', c.clientId]">{{ c.name }}</a>
                <span class="muted">{{ c.type }} · {{ c.document || 's/ documento' }}</span>
                @if (canEdit()) {
                  <p-button size="small" [text]="true" icon="pi pi-times" label="Remover" (onClick)="detach(c)" />
                }
              </li>
            }
          </ul>
        }
        @if (canEdit()) {
          <div class="attach">
            <input
              pInputText
              type="text"
              placeholder="Buscar cliente por nome"
              [value]="term()"
              (input)="onSearch($event)"
            />
            @if (results().length) {
              <ul class="results">
                @for (r of results(); track r.id) {
                  <li>
                    <span
                      >{{ r.name }} <small class="muted">{{ r.type }}</small></span
                    >
                    <p-button size="small" [text]="true" icon="pi pi-link" label="Vincular" (onClick)="attach(r)" />
                  </li>
                }
              </ul>
            }
          </div>
        }
      </p-card>

      @if (canEdit()) {
        <p-card header="Notificações deste processo" styleClass="section">
          @if (notifLoading()) {
            <div class="center"><p-progressSpinner styleClass="spinner-sm" /></div>
          } @else if (!notifOverride()) {
            <p class="muted">Este processo usa a configuração geral do espaço.</p>
            <p-button size="small" severity="secondary" [outlined]="true" icon="pi pi-sliders-h" label="Personalizar" (onClick)="enableNotifOverride()" />
          } @else {
            <div class="notif-row">
              <label class="chk" for="notifResponsible">
                <p-checkbox
                  inputId="notifResponsible"
                  [binary]="true"
                  [ngModel]="notifResponsible()"
                  (ngModelChange)="notifResponsible.set($event)"
                  [ngModelOptions]="{ standalone: true }"
                />
                Notificar o responsável
              </label>
              <p-select
                class="f"
                [disabled]="!notifResponsible()"
                [options]="responsibleTemplateOptions()"
                [ngModel]="notifResponsibleTemplateId()"
                (ngModelChange)="notifResponsibleTemplateId.set($event)"
                [ngModelOptions]="{ standalone: true }"
                placeholder="Mensagem genérica embutida"
              />
            </div>
            <div class="notif-row">
              <label class="chk" for="notifClients">
                <p-checkbox
                  inputId="notifClients"
                  [binary]="true"
                  [ngModel]="notifClients()"
                  (ngModelChange)="notifClients.set($event)"
                  [ngModelOptions]="{ standalone: true }"
                />
                Notificar os clientes
              </label>
              <p-select
                class="f"
                [disabled]="!notifClients()"
                [options]="clientTemplateOptions()"
                [ngModel]="notifClientTemplateId()"
                (ngModelChange)="notifClientTemplateId.set($event)"
                [ngModelOptions]="{ standalone: true }"
                placeholder="Mensagem genérica embutida"
              />
            </div>
            <div class="core-actions">
              <p-button size="small" icon="pi pi-check" label="Salvar" [loading]="notifSaving()" (onClick)="saveNotifOverride()" />
              <p-button size="small" severity="secondary" [text]="true" icon="pi pi-undo" label="Voltar ao padrão do espaço" (onClick)="removeNotifOverride()" />
            </div>
          }
        </p-card>
      }

      @if (isAdmin()) {
        <p-card header="Transferência de responsabilidade" styleClass="section">
          <div class="transfer">
            <p-select
              class="f"
              [options]="transferOptions()"
              [ngModel]="transferTarget()"
              (ngModelChange)="transferTarget.set($event)"
              [ngModelOptions]="{ standalone: true }"
              placeholder="Selecione o novo responsável…"
            />
            <p-button
              size="small"
              icon="pi pi-arrow-right-arrow-left"
              [disabled]="!transferTarget()"
              [loading]="transferring()"
              label="Transferir"
              (onClick)="transfer()"
            />
          </div>
          <p class="muted small">
            O responsável anterior perde o acesso ao processo imediatamente. O histórico é
            preservado.
          </p>
        </p-card>

        <p-card header="Histórico de responsabilidade" styleClass="section">
          @if (history().length === 0) {
            <p class="muted">Sem histórico.</p>
          } @else {
            <p-table [value]="history()" styleClass="p-datatable-sm">
              <ng-template pTemplate="header">
                <tr>
                  <th>Responsável</th>
                  <th>Motivo</th>
                  <th>Início</th>
                  <th>Fim</th>
                  <th>Atribuído por</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-h>
                <tr>
                  <td>{{ h.responsibleName }}</td>
                  <td>{{ h.reason === 'transfer' ? 'Transferência' : 'Cadastro' }}</td>
                  <td>{{ fmt(h.startedAt) }}</td>
                  <td>{{ h.endedAt ? fmt(h.endedAt) : 'atual' }}</td>
                  <td>{{ h.assignedByName || '—' }}</td>
                </tr>
              </ng-template>
            </p-table>
          }
        </p-card>
      }
    }
  `,
  styles: [
    `
      .center {
        display: flex;
        justify-content: center;
        padding: 2.5rem;
      }
      :host ::ng-deep .spinner-sm {
        width: 2.5rem;
        height: 2.5rem;
      }
      /* styleClass do p-card cai num div interno do template do PrimeNG, fora
         do encapsulamento deste componente — precisa de ::ng-deep, senão a
         regra nunca é aplicada. */
      :host ::ng-deep .section {
        display: block;
        margin-bottom: 1rem;
      }
      :host ::ng-deep .back-btn {
        display: inline-block;
      }
      /* 2 colunas fixas — igual ao resto do app: sem isso, um form com poucos
         campos afunda num cantinho do card e sobra vão vazio do lado. */
      .core {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 0.85rem 1.25rem;
        align-items: start;
      }
      @media (max-width: 32rem) {
        .core {
          grid-template-columns: 1fr;
        }
      }
      .field--full {
        grid-column: 1 / -1;
      }
      .ro {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
      }
      .ro span {
        font-size: 0.78rem;
        color: var(--jf-text-muted, #64748b);
      }
      .muted {
        color: var(--jf-text-muted, #64748b);
      }
      .small {
        font-size: 0.8rem;
      }
      .linked,
      .results {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }
      .linked li,
      .results li {
        display: flex;
        gap: 0.6rem;
        align-items: center;
        flex-wrap: wrap;
      }
      .movements {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.9rem;
      }
      .movements li {
        padding-bottom: 0.9rem;
        border-bottom: 1px solid var(--jf-border, #e2e8f0);
      }
      .movements li:last-child {
        border-bottom: 0;
        padding-bottom: 0;
      }
      .movements__meta {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .movements__date {
        font-size: 0.8125rem;
        font-weight: 600;
      }
      .movements__desc {
        margin: 0.4rem 0 0.2rem;
        font-size: 0.9rem;
      }
      .movements__collected {
        font-size: 0.75rem;
        color: var(--jf-text-muted, #64748b);
      }
      .attach {
        margin-top: 0.85rem;
      }
      .attach input {
        width: 100%;
        max-width: 24rem;
      }
      .transfer {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        flex-wrap: wrap;
      }
      .transfer .f {
        min-width: 16rem;
      }
      .notif-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.75rem;
        padding: 0.6rem 0;
        border-bottom: 1px solid var(--jf-border, #e2e8f0);
      }
      .chk {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.9rem;
        min-width: 14rem;
      }
      .notif-row .f {
        min-width: 14rem;
      }
      :host ::ng-deep .w-full {
        width: 100%;
      }
    `,
  ],
})
export class ProcessDetailComponent {
  readonly id = input.required<string>();

  private readonly fb = inject(FormBuilder);
  private readonly service = inject(ProcessService);
  private readonly clientService = inject(ClientService);
  private readonly membersService = inject(SpaceMembersService);
  private readonly activeSpace = inject(ActiveSpaceService);
  private readonly auth = inject(AuthService);
  private readonly permissions = inject(PermissionService);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly notifConfigService = inject(NotificationConfigService);
  private readonly templateService = inject(TemplateService);
  private readonly pageHeader = inject(PageHeaderService);

  protected readonly loading = signal(true);
  protected readonly process = signal<ProcessDetail | null>(null);
  protected readonly clients = signal<LinkedClient[]>([]);
  protected readonly movements = signal<MovementRow[]>([]);
  protected readonly movementsLoading = signal(true);
  protected readonly history = signal<HistoryRow[]>([]);
  protected readonly members = signal<SpaceMemberOption[]>([]);
  protected readonly savingCore = signal(false);
  protected readonly transferring = signal(false);
  protected readonly transferTarget = signal('');
  protected readonly term = signal('');
  protected readonly results = signal<Client[]>([]);
  protected readonly msg = signal<{ tone: 'error' | 'success' | 'warn'; text: string } | null>(
    null,
  );

  protected readonly notifLoading = signal(true);
  protected readonly notifOverride = signal(false);
  protected readonly notifSaving = signal(false);
  protected readonly notifResponsible = signal(true);
  protected readonly notifClients = signal(true);
  protected readonly notifResponsibleTemplateId = signal('');
  protected readonly notifClientTemplateId = signal('');
  private readonly notifTemplates = signal<MessageTemplate[]>([]);
  protected readonly notifResponsibleTemplates = computed(() =>
    this.notifTemplates().filter((t) => t.audience === 'responsible'),
  );
  protected readonly notifClientTemplates = computed(() =>
    this.notifTemplates().filter((t) => t.audience === 'client'),
  );
  protected readonly responsibleTemplateOptions = computed(() => [
    { label: 'Mensagem genérica embutida', value: '' },
    ...this.notifResponsibleTemplates().map((t) => ({ label: t.name, value: t.id })),
  ]);
  protected readonly clientTemplateOptions = computed(() => [
    { label: 'Mensagem genérica embutida', value: '' },
    ...this.notifClientTemplates().map((t) => ({ label: t.name, value: t.id })),
  ]);
  protected readonly transferOptions = computed(() => [
    { label: 'Selecione o novo responsável…', value: '' },
    ...this.members()
      .filter((m) => m.profileId !== this.process()?.assignedUserId)
      .map((m) => ({ label: `${m.fullName} (${m.role})`, value: m.profileId })),
  ]);

  protected readonly coreForm = this.fb.nonNullable.group({ cnjNumber: '', internalRef: '' });

  protected fmt(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR');
  }

  protected sourceLabel(sourceKind: string): string {
    return sourceKind === 'projudi_tjam' ? 'Projudi/TJAM' : sourceKind;
  }

  protected readonly isAdmin = (): boolean => this.permissions.can('space.manage');
  protected readonly canEdit = computed(() => {
    const p = this.process();
    if (!p) return false;
    return (
      this.permissions.can('space.manage') ||
      (p.createdBy === this.auth.userId() && p.assignedUserId === this.auth.userId())
    );
  });
  protected readonly statusTone = (): 'success' | 'secondary' | 'warn' => {
    const s = this.process()?.status;
    return s === 'active' ? 'success' : s === 'closed' ? 'secondary' : 'warn';
  };
  private readonly statusLabel: Record<string, string> = {
    active: 'Ativo',
    archived: 'Arquivado',
    closed: 'Encerrado',
  };

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const p = this.process();
      this.pageHeader.set(
        p?.cnjNumber || p?.internalRef || 'Processo',
        p ? this.statusLabel[p.status] : undefined,
      );
    });
    queueMicrotask(() => void this.load());
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const p = await this.service.getById(this.id());
      this.process.set(p);
      if (!p) return;
      this.coreForm.patchValue({ cnjNumber: p.cnjNumber ?? '', internalRef: p.internalRef ?? '' });
      const tasks: Promise<unknown>[] = [
        this.service.listClients(p.id).then((c) => this.clients.set(c)),
        this.service
          .movements(p.id)
          .then((m) => this.movements.set(m))
          .finally(() => this.movementsLoading.set(false)),
      ];
      if (this.isAdmin()) {
        const spaceId = this.activeSpace.activeSpaceId();
        tasks.push(this.service.history(p.id).then((h) => this.history.set(h)));
        if (spaceId)
          tasks.push(this.membersService.listActive(spaceId).then((m) => this.members.set(m)));
      }
      if (this.canEdit()) tasks.push(this.loadNotifConfig(p.id));
      await Promise.all(tasks);
    } catch {
      this.toast.error('Não foi possível carregar o processo.');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadNotifConfig(processId: string): Promise<void> {
    this.notifLoading.set(true);
    try {
      const [config, templates] = await Promise.all([
        this.notifConfigService.getForProcess(processId),
        this.templateService.list(),
      ]);
      this.notifTemplates.set(templates);
      this.notifOverride.set(config !== null);
      if (config) {
        this.notifResponsible.set(config.notifyResponsible ?? true);
        this.notifClients.set(config.notifyClients ?? true);
        this.notifResponsibleTemplateId.set(config.responsibleTemplateId ?? '');
        this.notifClientTemplateId.set(config.clientTemplateId ?? '');
      }
    } catch {
      this.toast.error('Não foi possível carregar as notificações do processo.');
    } finally {
      this.notifLoading.set(false);
    }
  }

  protected enableNotifOverride(): void {
    this.notifOverride.set(true);
  }

  protected async saveNotifOverride(): Promise<void> {
    const p = this.process();
    if (!p) return;
    this.notifSaving.set(true);
    try {
      await this.notifConfigService.upsertForProcess(p.id, {
        notifyResponsible: this.notifResponsible(),
        notifyClients: this.notifClients(),
        responsibleTemplateId: this.notifResponsibleTemplateId() || null,
        clientTemplateId: this.notifClientTemplateId() || null,
      });
      this.toast.success('Notificações do processo atualizadas.');
    } catch {
      this.toast.error('Não foi possível salvar as notificações do processo.');
    } finally {
      this.notifSaving.set(false);
    }
  }

  protected async removeNotifOverride(): Promise<void> {
    const p = this.process();
    if (!p) return;
    try {
      await this.notifConfigService.clearProcessOverride(p.id);
      this.notifOverride.set(false);
      this.toast.success('Processo voltou a usar o padrão do espaço.');
    } catch {
      this.toast.error('Não foi possível remover a personalização.');
    }
  }

  protected async saveCore(): Promise<void> {
    if (!this.canEdit()) return;
    this.savingCore.set(true);
    this.msg.set(null);
    try {
      const v = this.coreForm.getRawValue();
      await this.service.updateCore(this.id(), {
        cnjNumber: v.cnjNumber.trim() || null,
        internalRef: v.internalRef.trim() || null,
      });
      this.toast.success('Dados atualizados.');
      await this.load();
    } catch (err) {
      this.msg.set({ tone: 'error', text: this.humanize(err) });
    } finally {
      this.savingCore.set(false);
    }
  }

  protected async setStatus(status: 'active' | 'archived' | 'closed'): Promise<void> {
    this.msg.set(null);
    try {
      await this.service.setStatus(this.id(), status);
      await this.load();
    } catch (err) {
      this.msg.set({ tone: 'error', text: this.humanize(err) });
    }
  }

  protected async transfer(): Promise<void> {
    const target = this.transferTarget();
    if (!target) return;
    const name =
      this.members().find((m) => m.profileId === target)?.fullName ?? 'o usuário selecionado';
    const ok = await this.dialog.confirm({
      title: 'Transferir processo',
      message: `Transferir a responsabilidade para ${name}? O responsável atual perde o acesso imediatamente.`,
      confirmLabel: 'Transferir',
    });
    if (!ok) return;
    this.transferring.set(true);
    try {
      await this.service.transfer(this.id(), target);
      this.transferTarget.set('');
      this.toast.success('Processo transferido.');
      await this.load();
    } catch (err) {
      this.msg.set({ tone: 'error', text: this.humanize(err) });
    } finally {
      this.transferring.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Excluir processo',
      message:
        'O processo deixará de aparecer nas listagens. O histórico e a auditoria são preservados.',
      confirmLabel: 'Excluir',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await this.service.softDelete(this.id());
      this.toast.success('Processo excluído.');
      await this.router.navigate(['/processos']);
    } catch (err) {
      this.msg.set({ tone: 'error', text: this.humanize(err) });
    }
  }

  protected onSearch(event: Event): void {
    const t = (event.target as HTMLInputElement).value;
    this.term.set(t);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(async () => {
      if (t.trim().length < 2) {
        this.results.set([]);
        return;
      }
      try {
        const linked = new Set(this.clients().map((c) => c.clientId));
        const found = await this.clientService.search(t);
        this.results.set(found.filter((c) => !linked.has(c.id)));
      } catch {
        this.results.set([]);
      }
    }, 250);
  }

  protected async attach(c: Client): Promise<void> {
    try {
      await this.service.attachClient(this.id(), c.id);
      this.term.set('');
      this.results.set([]);
      await this.load();
    } catch (err) {
      this.msg.set({ tone: 'error', text: this.humanize(err) });
    }
  }

  protected async detach(c: LinkedClient): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Remover cliente do processo',
      message: `Desvincular "${c.name}" deste processo?`,
      confirmLabel: 'Remover',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await this.service.detachClient(c.linkId);
      await this.load();
    } catch (err) {
      this.msg.set({ tone: 'error', text: this.humanize(err) });
    }
  }

  private humanize(err: unknown): string {
    const m = (err as { message?: string })?.message ?? '';
    if (m.includes('Encerrar ou reabrir'))
      return 'Encerrar ou reabrir um processo é ação de ADMIN.';
    if (m.includes('Transferência de responsável é ação de ADMIN'))
      return 'Só ADMIN transfere processos.';
    if (m.includes('Alterar o tribunal')) return 'Só ADMIN altera o tribunal do processo.';
    if (m.includes('novo responsável deve ser um membro ativo'))
      return 'O novo responsável precisa ser membro ativo do espaço.';
    if (m.includes('já é o responsável atual')) return 'Esse usuário já é o responsável atual.';
    if (m.includes('processes_cnj_uniq'))
      return 'Já existe um processo com esse número CNJ neste espaço.';
    if (m.includes('row-level security') || m.includes('permissão') || m.includes('permission'))
      return 'Você não tem permissão para esta ação.';
    return 'Não foi possível concluir a operação.';
  }
}
