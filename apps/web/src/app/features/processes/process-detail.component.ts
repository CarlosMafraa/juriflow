import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { Client } from '@juriflow/shared-types';
import {
  ProcessService,
  type HistoryRow,
  type LinkedClient,
  type ProcessDetail,
} from './process.service';
import { ClientService } from '../clients/client.service';
import { SpaceMembersService, type SpaceMemberOption } from '../../core/data/space-members.service';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';
import { AuthService } from '../../core/auth/auth.service';
import { PermissionService } from '../../core/authorization/permission.service';
import { DialogService } from '../../shared/ui/dialog.service';
import { ToastService } from '../../shared/feedback/toast.service';
import { AlertComponent } from '../../shared/ui/alert.component';
import { ButtonComponent } from '../../shared/ui/button.component';
import { CardComponent } from '../../shared/ui/card.component';
import { BadgeComponent } from '../../shared/ui/badge.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { ProcessTrackingPanelComponent } from './process-tracking-panel.component';

@Component({
  selector: 'jf-process-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlertComponent,
    ButtonComponent,
    CardComponent,
    BadgeComponent,
    SpinnerComponent,
    EmptyStateComponent,
    ProcessTrackingPanelComponent,
  ],
  template: `
    @if (loading()) {
      <div class="center"><jf-spinner [showLabel]="true" /></div>
    } @else if (!process()) {
      <jf-empty-state title="Processo não encontrado" message="Ele pode ter sido transferido, arquivado ou você não tem acesso.">
        <span empty-icon>🔒</span>
        <a empty-action routerLink="/processos"><jf-button variant="secondary">Voltar</jf-button></a>
      </jf-empty-state>
    } @else {
      <header class="head">
        <div>
          <h1>{{ process()!.cnjNumber || process()!.internalRef || 'Processo' }}</h1>
          <jf-badge [tone]="statusTone()">{{ process()!.status }}</jf-badge>
        </div>
        <div class="acts">
          @if (canEdit() && process()!.status !== 'closed') {
            @if (process()!.status === 'active') {
              <jf-button variant="secondary" (click)="setStatus('archived')">Arquivar</jf-button>
            } @else {
              <jf-button variant="secondary" (click)="setStatus('active')">Reativar</jf-button>
            }
          }
          @if (isAdmin()) {
            @if (process()!.status !== 'closed') {
              <jf-button variant="secondary" (click)="setStatus('closed')">Encerrar</jf-button>
            } @else {
              <jf-button variant="secondary" (click)="setStatus('active')">Reabrir</jf-button>
            }
          }
          @if (canEdit()) {
            <jf-button variant="danger" (click)="remove()">Excluir</jf-button>
          }
        </div>
      </header>

      @if (msg()) {
        <jf-alert [tone]="msg()!.tone">{{ msg()!.text }}</jf-alert>
      }

      <jf-card title="Dados">
        <form [formGroup]="coreForm" (ngSubmit)="saveCore()" class="core">
          <label>
            <span>Número CNJ</span>
            <input formControlName="cnjNumber" [readonly]="!canEdit()" placeholder="—" />
          </label>
          <label>
            <span>Referência interna</span>
            <input formControlName="internalRef" [readonly]="!canEdit()" placeholder="—" />
          </label>
          <div class="ro"><span>Tribunal</span><strong>{{ process()!.courtName }}</strong></div>
          <div class="ro"><span>Responsável atual</span><strong>{{ process()!.assignedName }}</strong></div>
          <div class="ro"><span>Cadastrado por</span><strong>{{ process()!.creatorName }}</strong></div>
          @if (canEdit()) {
            <div class="core-actions">
              <jf-button type="submit" size="sm" [loading]="savingCore()">Salvar dados</jf-button>
            </div>
          }
        </form>
      </jf-card>

      <jf-card title="Clientes vinculados">
        @if (clients().length === 0) {
          <p class="muted">Nenhum cliente vinculado.</p>
        } @else {
          <ul class="linked">
            @for (c of clients(); track c.linkId) {
              <li>
                <a [routerLink]="['/clientes', c.clientId]">{{ c.name }}</a>
                <span class="muted">{{ c.type }} · {{ c.document || 's/ documento' }}</span>
                @if (canEdit()) {
                  <jf-button size="sm" variant="ghost" (click)="detach(c)">Remover</jf-button>
                }
              </li>
            }
          </ul>
        }
        @if (canEdit()) {
          <div class="attach">
            <input type="text" placeholder="Buscar cliente por nome" [value]="term()" (input)="onSearch($event)" />
            @if (results().length) {
              <ul class="results">
                @for (r of results(); track r.id) {
                  <li>
                    <span>{{ r.name }} <small class="muted">{{ r.type }}</small></span>
                    <jf-button size="sm" variant="ghost" (click)="attach(r)">Vincular</jf-button>
                  </li>
                }
              </ul>
            }
          </div>
        }
      </jf-card>

      <jf-process-tracking-panel
        [processId]="process()!.id"
        [courtId]="process()!.courtId"
        [canOperate]="canOperateTracking()"
      />

      @if (isAdmin()) {
        <jf-card title="Transferência de responsabilidade">
          <div class="transfer">
            <select [value]="transferTarget()" (change)="transferTarget.set($any($event.target).value)">
              <option value="">Selecione o novo responsável…</option>
              @for (m of members(); track m.profileId) {
                @if (m.profileId !== process()!.assignedUserId) {
                  <option [value]="m.profileId">{{ m.fullName }} ({{ m.role }})</option>
                }
              }
            </select>
            <jf-button [disabled]="!transferTarget()" [loading]="transferring()" (click)="transfer()">Transferir</jf-button>
          </div>
          <p class="muted small">
            O responsável anterior perde o acesso ao processo imediatamente. O histórico é preservado.
          </p>
        </jf-card>

        <jf-card title="Histórico de responsabilidade">
          @if (history().length === 0) {
            <p class="muted">Sem histórico.</p>
          } @else {
            <div class="table-wrap">
              <table>
                <thead>
                  <tr><th>Responsável</th><th>Motivo</th><th>Início</th><th>Fim</th><th>Atribuído por</th></tr>
                </thead>
                <tbody>
                  @for (h of history(); track h.id) {
                    <tr>
                      <td>{{ h.responsibleName }}</td>
                      <td>{{ h.reason === 'transfer' ? 'Transferência' : 'Cadastro' }}</td>
                      <td>{{ fmt(h.startedAt) }}</td>
                      <td>{{ h.endedAt ? fmt(h.endedAt) : 'atual' }}</td>
                      <td>{{ h.assignedByName || '—' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </jf-card>
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
      .head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 1rem;
        flex-wrap: wrap;
        margin-bottom: 1rem;
      }
      .head h1 {
        margin: 0 0 0.35rem;
        font-size: 1.3rem;
      }
      .acts {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      jf-card {
        display: block;
        margin-bottom: 1rem;
      }
      .core {
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
        max-width: 30rem;
      }
      .core label,
      .ro {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
      }
      .core label span,
      .ro span {
        font-size: 0.78rem;
        color: var(--jf-text-muted, #64748b);
      }
      .core input {
        font: inherit;
        padding: 0.5rem 0.7rem;
        border: 1px solid var(--jf-border, #cbd5e1);
        border-radius: var(--jf-radius, 8px);
      }
      .core input[readonly] {
        background: var(--jf-surface-muted, #f1f5f9);
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
      .attach {
        margin-top: 0.85rem;
      }
      .attach input,
      .transfer select {
        font: inherit;
        padding: 0.5rem 0.7rem;
        border: 1px solid var(--jf-border, #cbd5e1);
        border-radius: var(--jf-radius, 8px);
        width: 100%;
        max-width: 24rem;
      }
      .transfer {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        flex-wrap: wrap;
      }
      .table-wrap {
        overflow-x: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.85rem;
      }
      th,
      td {
        text-align: left;
        padding: 0.5rem 0.7rem;
        border-bottom: 1px solid var(--jf-border, #e2e8f0);
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

  protected readonly loading = signal(true);
  protected readonly process = signal<ProcessDetail | null>(null);
  protected readonly clients = signal<LinkedClient[]>([]);
  protected readonly history = signal<HistoryRow[]>([]);
  protected readonly members = signal<SpaceMemberOption[]>([]);
  protected readonly savingCore = signal(false);
  protected readonly transferring = signal(false);
  protected readonly transferTarget = signal('');
  protected readonly term = signal('');
  protected readonly results = signal<Client[]>([]);
  protected readonly msg = signal<{ tone: 'danger' | 'success' | 'warning'; text: string } | null>(null);

  protected readonly coreForm = this.fb.nonNullable.group({ cnjNumber: '', internalRef: '' });

  protected fmt(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR');
  }

  protected readonly isAdmin = (): boolean => this.permissions.can('space.manage');
  /** Operar acompanhamento: ADMIN do espaço OU responsável atual (RLS/RPC confirmam). */
  protected readonly canOperateTracking = computed(() => {
    const p = this.process();
    if (!p) return false;
    return this.permissions.can('space.manage') || p.assignedUserId === this.auth.userId();
  });
  protected readonly canEdit = computed(() => {
    const p = this.process();
    if (!p) return false;
    return (
      this.permissions.can('space.manage') ||
      (p.createdBy === this.auth.userId() && p.assignedUserId === this.auth.userId())
    );
  });
  protected readonly statusTone = (): 'success' | 'neutral' | 'warning' => {
    const s = this.process()?.status;
    return s === 'active' ? 'success' : s === 'closed' ? 'neutral' : 'warning';
  };

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
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
      ];
      if (this.isAdmin()) {
        const spaceId = this.activeSpace.activeSpaceId();
        tasks.push(this.service.history(p.id).then((h) => this.history.set(h)));
        if (spaceId) tasks.push(this.membersService.listActive(spaceId).then((m) => this.members.set(m)));
      }
      await Promise.all(tasks);
    } catch {
      this.toast.error('Não foi possível carregar o processo.');
    } finally {
      this.loading.set(false);
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
      this.msg.set({ tone: 'danger', text: this.humanize(err) });
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
      this.msg.set({ tone: 'danger', text: this.humanize(err) });
    }
  }

  protected async transfer(): Promise<void> {
    const target = this.transferTarget();
    if (!target) return;
    const name = this.members().find((m) => m.profileId === target)?.fullName ?? 'o usuário selecionado';
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
      this.msg.set({ tone: 'danger', text: this.humanize(err) });
    } finally {
      this.transferring.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Excluir processo',
      message: 'O processo deixará de aparecer nas listagens. O histórico e a auditoria são preservados.',
      confirmLabel: 'Excluir',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await this.service.softDelete(this.id());
      this.toast.success('Processo excluído.');
      await this.router.navigate(['/processos']);
    } catch (err) {
      this.msg.set({ tone: 'danger', text: this.humanize(err) });
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
      this.msg.set({ tone: 'danger', text: this.humanize(err) });
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
      this.msg.set({ tone: 'danger', text: this.humanize(err) });
    }
  }

  private humanize(err: unknown): string {
    const m = (err as { message?: string })?.message ?? '';
    if (m.includes('Encerrar ou reabrir')) return 'Encerrar ou reabrir um processo é ação de ADMIN.';
    if (m.includes('Transferência de responsável é ação de ADMIN')) return 'Só ADMIN transfere processos.';
    if (m.includes('Alterar o tribunal')) return 'Só ADMIN altera o tribunal do processo.';
    if (m.includes('novo responsável deve ser um membro ativo')) return 'O novo responsável precisa ser membro ativo do espaço.';
    if (m.includes('já é o responsável atual')) return 'Esse usuário já é o responsável atual.';
    if (m.includes('processes_cnj_uniq')) return 'Já existe um processo com esse número CNJ neste espaço.';
    if (m.includes('row-level security') || m.includes('permissão') || m.includes('permission'))
      return 'Você não tem permissão para esta ação.';
    return 'Não foi possível concluir a operação.';
  }
}
