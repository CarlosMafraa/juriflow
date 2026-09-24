import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { formatCnjNumber, isFormattedCnj } from '@juriflow/domain';
import type { Client, Court } from '@juriflow/shared-types';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ChipModule } from 'primeng/chip';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { ProcessService } from './process.service';
import { CourtService } from '../courts/court.service';
import { ClientService } from '../clients/client.service';
import { SpaceMembersService, type SpaceMemberOption } from '../../core/data/space-members.service';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';
import { AuthService } from '../../core/auth/auth.service';
import { PermissionService } from '../../core/authorization/permission.service';
import { ToastService } from '../../shared/feedback/toast.service';

@Component({
  selector: 'jf-process-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    CardModule,
    ChipModule,
    InputTextModule,
    MessageModule,
    SelectModule,
  ],
  template: `
    <header class="head"><h1>Novo processo</h1></header>
    <p-card>
      <form [formGroup]="form" (ngSubmit)="submit()" class="form">
        @if (error()) {
          <p-message severity="error" [text]="error()" styleClass="w-full" />
        }

        <div class="field">
          <label for="cnjNumber">Número CNJ (opcional)</label>
          <input pInputText id="cnjNumber" formControlName="cnjNumber" />
          @if (cnjError()) {
            <small class="field__error">{{ cnjError() }}</small>
          } @else {
            <small class="field__hint">
              Formato NNNNNNN-DD.AAAA.J.TR.OOOO. Sem CNJ, o processo não entra em acompanhamento automático.
            </small>
          }
        </div>
        <div class="field">
          <label for="internalRef">Referência interna (opcional)</label>
          <input pInputText id="internalRef" formControlName="internalRef" />
        </div>

        <div class="field">
          <label for="courtId">Tribunal</label>
          <p-select
            inputId="courtId"
            [options]="courtOptionList()"
            formControlName="courtId"
            placeholder="Selecione…"
          />
        </div>

        <div class="field">
          <label for="assignedUserId">Responsável</label>
          @if (isAdmin()) {
            <p-select
              inputId="assignedUserId"
              [options]="memberOptionList()"
              formControlName="assignedUserId"
              placeholder="Selecione…"
              aria-label="Responsável"
            />
          } @else {
            <input pInputText type="text" [value]="myName()" disabled aria-label="Responsável" />
            <small class="field__hint">Colaborador cadastra o processo para si.</small>
          }
        </div>

        <fieldset class="clients">
          <legend>Clientes (opcional)</legend>
          <div class="search">
            <input pInputText type="text" placeholder="Buscar cliente por nome" [value]="term()" (input)="onSearch($event)" />
          </div>
          @if (results().length) {
            <ul class="results">
              @for (c of results(); track c.id) {
                <li>
                  <span>{{ c.name }} <small class="muted">{{ c.type }}</small></span>
                  <p-button type="button" size="small" [text]="true" icon="pi pi-plus" label="Adicionar" (onClick)="pick(c)" />
                </li>
              }
            </ul>
          }
          @if (selected().length) {
            <div class="chips">
              @for (c of selected(); track c.id) {
                <p-chip [label]="c.name" [removable]="true" (onRemove)="unpick(c.id)" />
              }
            </div>
          }
        </fieldset>

        <div class="actions">
          <p-button type="button" severity="secondary" [outlined]="true" icon="pi pi-times" label="Cancelar" (onClick)="cancel()" />
          <p-button type="submit" icon="pi pi-plus" label="Cadastrar" [loading]="saving()" />
        </div>
      </form>
    </p-card>
  `,
  styles: [
    `
      .head h1 {
        margin: 0 0 1rem;
        font-size: 1.35rem;
      }
      .form {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        max-width: 34rem;
      }
      .muted {
        color: var(--jf-text-muted, #64748b);
        font-weight: 400;
      }
      .clients {
        border: 1px solid var(--jf-border, #e2e8f0);
        border-radius: var(--jf-radius, 8px);
        padding: 0.75rem 1rem;
      }
      legend {
        font-size: 0.8125rem;
        font-weight: 600;
        padding: 0 0.4rem;
      }
      .search input {
        width: 100%;
      }
      .results {
        list-style: none;
        margin: 0.5rem 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
      }
      .results li {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .chips {
        margin: 0.5rem 0 0;
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
      }
      :host ::ng-deep .w-full {
        width: 100%;
      }
    `,
  ],
})
export class ProcessFormComponent {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(ProcessService);
  private readonly courtService = inject(CourtService);
  private readonly clientService = inject(ClientService);
  private readonly membersService = inject(SpaceMembersService);
  private readonly activeSpace = inject(ActiveSpaceService);
  private readonly auth = inject(AuthService);
  private readonly permissions = inject(PermissionService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly courts = signal<Court[]>([]);
  protected readonly members = signal<SpaceMemberOption[]>([]);
  protected readonly term = signal('');
  protected readonly results = signal<Client[]>([]);
  protected readonly selected = signal<Client[]>([]);

  protected readonly isAdmin = (): boolean => this.permissions.can('space.manage');
  protected readonly myName = (): string => this.auth.context()?.profile?.fullName ?? this.auth.context()?.email ?? '';

  protected readonly courtOptionList = (): Array<{ label: string; value: string }> =>
    this.courts().map((c) => ({ label: `${c.name} — ${c.jurisdiction}`, value: c.id }));
  protected readonly memberOptionList = (): Array<{ label: string; value: string }> =>
    this.members().map((m) => ({ label: `${m.fullName} (${m.role})`, value: m.profileId }));

  protected readonly form = this.fb.nonNullable.group({
    cnjNumber: '',
    internalRef: '',
    courtId: ['', [Validators.required]],
    assignedUserId: '',
  });

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    void this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    const spaceId = this.activeSpace.activeSpaceId();
    try {
      this.courts.set(await this.courtService.list());
      if (this.isAdmin() && spaceId) {
        this.members.set(await this.membersService.listActive(spaceId));
      }
    } catch {
      this.error.set('Não foi possível carregar tribunais/membros.');
    }
  }

  protected cnjError(): string {
    const raw = this.form.value.cnjNumber?.trim();
    if (!raw) return '';
    return formatCnjNumber(raw) || isFormattedCnj(raw) ? '' : 'Número CNJ inválido (precisa de 20 dígitos).';
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
        const found = await this.clientService.search(t);
        const chosen = new Set(this.selected().map((c) => c.id));
        this.results.set(found.filter((c) => !chosen.has(c.id)));
      } catch {
        this.results.set([]);
      }
    }, 250);
  }

  protected pick(c: Client): void {
    this.selected.update((list) => [...list, c]);
    this.results.update((list) => list.filter((r) => r.id !== c.id));
  }

  protected unpick(id: string): void {
    this.selected.update((list) => list.filter((c) => c.id !== id));
  }

  protected cancel(): void {
    void this.router.navigate(['/processos']);
  }

  protected async submit(): Promise<void> {
    this.error.set('');
    if (this.form.invalid || this.cnjError()) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const assignedUserId = this.isAdmin() ? v.assignedUserId : (this.auth.userId() ?? '');
    if (!assignedUserId) {
      this.error.set('Selecione o responsável.');
      return;
    }

    this.saving.set(true);
    try {
      const cnj = v.cnjNumber.trim() ? (formatCnjNumber(v.cnjNumber) ?? v.cnjNumber.trim()) : null;
      const { id } = await this.service.create({
        cnjNumber: cnj,
        internalRef: v.internalRef,
        courtId: v.courtId,
        assignedUserId,
      });
      for (const c of this.selected()) {
        try {
          await this.service.attachClient(id, c.id);
        } catch {
          this.toast.warning(`Não foi possível vincular o cliente ${c.name}.`);
        }
      }
      this.toast.success('Processo cadastrado.');
      await this.router.navigate(['/processos', id]);
    } catch (err) {
      this.error.set(this.humanize(err));
    } finally {
      this.saving.set(false);
    }
  }

  private humanize(err: unknown): string {
    const msg = (err as { message?: string })?.message ?? '';
    if (msg.includes('processes_cnj_uniq')) return 'Já existe um processo com esse número CNJ neste espaço.';
    if (msg.includes('processes_cnj_format_chk')) return 'Número CNJ fora do formato padrão.';
    if (msg.includes('Tribunal inexistente ou inativo')) return 'Tribunal inexistente ou inativo.';
    if (msg.includes('membro ativo do espaço')) return 'O responsável precisa ser um membro ativo do espaço.';
    return 'Não foi possível cadastrar o processo.';
  }
}
