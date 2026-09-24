import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule } from '@angular/forms';
import type { SpaceInvite, SpaceRole } from '@juriflow/shared-types';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { AuthService } from '../../core/auth/auth.service';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';
import { PermissionService } from '../../core/authorization/permission.service';
import { ToastService } from '../../shared/feedback/toast.service';
import { DialogService } from '../../shared/ui/dialog.service';
import { TeamService, type TeamMember } from './team.service';

const ROLE_OPTIONS = [
  { value: 'COLABORADOR', label: 'Colaborador — acessa só os processos sob sua responsabilidade' },
  { value: 'ADMIN', label: 'Administrador — acesso total ao espaço' },
];

@Component({
  selector: 'jf-team-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    FormsModule,
    ButtonModule,
    CardModule,
    InputTextModule,
    ProgressSpinnerModule,
    SelectModule,
    TagModule,
  ],
  template: `
    <header class="head">
      <h1>Equipe</h1>
      @if (hasActiveSpace() && isAdmin()) {
        <p-button
          size="small"
          [icon]="showInviteForm() ? 'pi pi-times' : 'pi pi-user-plus'"
          [label]="showInviteForm() ? 'Cancelar' : 'Convidar'"
          (onClick)="toggleInviteForm()"
        />
      }
    </header>

    @if (loading()) {
      <div class="center"><p-progressSpinner styleClass="spinner-sm" /></div>
    } @else {
      @if (myPendingInvites().length > 0) {
        <p-card header="Convites recebidos" styleClass="section">
          <ul class="list">
            @for (invite of myPendingInvites(); track invite.id) {
              <li class="row">
                <div class="min0">
                  <p class="name">{{ invite.spaceName }}</p>
                  <p class="muted">
                    {{ invite.role === 'ADMIN' ? 'Administrador' : 'Colaborador' }}
                  </p>
                </div>
                <p-button
                  size="small"
                  icon="pi pi-check"
                  [loading]="accepting() === invite.token"
                  label="Aceitar"
                  (onClick)="accept(invite)"
                />
              </li>
            }
          </ul>
        </p-card>
      }

      @if (hasActiveSpace() && isAdmin() && showInviteForm()) {
        <p-card header="Convidar usuário" styleClass="section">
          <form class="invite-form" [formGroup]="inviteForm" (ngSubmit)="submitInvite()">
            <div class="field">
              <label for="invite-email">E-mail</label>
              <input pInputText id="invite-email" type="email" placeholder="pessoa@escritorio.com.br" formControlName="email" />
            </div>
            <div class="field">
              <label for="invite-role">Papel</label>
              <p-select inputId="invite-role" [options]="roleOptions" formControlName="role" />
            </div>
            <p-button type="submit" icon="pi pi-send" [loading]="inviting()" label="Enviar convite" />
          </form>
        </p-card>
      }

      @if (!hasActiveSpace()) {
        <p class="muted note">
          Você ainda não faz parte de nenhum espaço. Aceite um convite acima, se houver, ou peça a
          um administrador para te convidar.
        </p>
      } @else {
        <p-card header="Membros" styleClass="section">
          @if (members().length === 0) {
            <p class="muted">
              Nenhum membro. Convide pessoas para colaborar no acompanhamento dos processos.
            </p>
          } @else {
            <ul class="list">
              @for (m of members(); track m.id) {
                <li class="row">
                  <div class="min0">
                    <p class="name">
                      {{ m.name }}
                      @if (m.profileId === currentUserId()) {
                        <span class="muted"> (você)</span>
                      }
                    </p>
                    <p class="muted">{{ m.email || '—' }}</p>
                  </div>
                  <div class="actions">
                    @if (!m.active) {
                      <p-tag severity="secondary" value="Inativo" />
                    }
                    @if (isAdmin()) {
                      <p-select
                        class="role-select"
                        [attr.aria-label]="'Papel de ' + m.name"
                        [disabled]="isLastActiveAdmin(m)"
                        [options]="roleOptions"
                        [ngModel]="m.role"
                        (ngModelChange)="changeRole(m, $event)"
                        [ngModelOptions]="{ standalone: true }"
                      />
                    } @else {
                      <p-tag severity="info" [value]="m.role === 'ADMIN' ? 'Administrador' : 'Colaborador'" />
                    }
                    @if (isAdmin() && m.profileId !== currentUserId()) {
                      <p-button
                        size="small"
                        severity="secondary"
                        [outlined]="true"
                        [disabled]="isLastActiveAdmin(m)"
                        [icon]="m.active ? 'pi pi-ban' : 'pi pi-refresh'"
                        [label]="m.active ? 'Desativar' : 'Reativar'"
                        (onClick)="toggleActive(m)"
                      />
                    }
                  </div>
                </li>
              }
            </ul>
          }
        </p-card>

        @if (isAdmin()) {
          <p-card header="Convites pendentes" styleClass="section">
            @if (pendingInvites().length === 0) {
              <p class="muted">
                Nenhum convite pendente. Use o botão Convidar para adicionar alguém ao espaço.
              </p>
            } @else {
              <ul class="list">
                @for (invite of pendingInvites(); track invite.id) {
                  <li class="row">
                    <div class="min0">
                      <p class="name">{{ invite.email }}</p>
                      <p class="muted">
                        {{ invite.role === 'ADMIN' ? 'Administrador' : 'Colaborador' }} · expira em
                        {{ invite.expiresAt | date: 'dd/MM/yyyy' }}
                      </p>
                    </div>
                    <p-button size="small" icon="pi pi-times" [text]="true" label="Cancelar" (onClick)="cancelInvite(invite)" />
                  </li>
                }
              </ul>
            }
          </p-card>
        } @else {
          <p class="muted note">
            Somente administradores podem convidar usuários ou alterar papéis.
          </p>
        }
      }
    }
  `,
  styles: [
    `
      .head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1rem;
      }
      .head h1 {
        margin: 0;
        font-size: 1.35rem;
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
      .section {
        display: block;
        margin-bottom: 1rem;
      }
      .invite-form {
        display: grid;
        gap: 1rem;
        max-width: 28rem;
      }
      .list {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.75rem 0;
        border-bottom: 1px solid var(--jf-border, #e2e8f0);
        flex-wrap: wrap;
      }
      .row:last-child {
        border-bottom: 0;
      }
      .min0 {
        min-width: 0;
      }
      .name {
        margin: 0;
        font-weight: 600;
        font-size: 0.9rem;
      }
      .muted {
        margin: 0.15rem 0 0;
        font-size: 0.8125rem;
        color: var(--jf-text-muted, #64748b);
      }
      .actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .role-select {
        min-width: 11rem;
      }
      .note {
        text-align: center;
        padding: 1rem 0;
      }
    `,
  ],
})
export class TeamListComponent {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(TeamService);
  private readonly toast = inject(ToastService);
  private readonly dialogs = inject(DialogService);
  private readonly auth = inject(AuthService);
  private readonly permissions = inject(PermissionService);
  private readonly activeSpace = inject(ActiveSpaceService);

  protected readonly roleOptions = ROLE_OPTIONS;
  protected readonly currentUserId = this.auth.userId;
  protected readonly hasActiveSpace = computed(() => this.activeSpace.activeSpaceId() !== null);
  protected readonly isAdmin = computed(() => this.permissions.can('member.role.update'));

  protected readonly loading = signal(true);
  protected readonly members = signal<TeamMember[]>([]);
  protected readonly pendingInvites = signal<SpaceInvite[]>([]);
  protected readonly myPendingInvites = signal<SpaceInvite[]>([]);
  protected readonly showInviteForm = signal(false);
  protected readonly inviting = signal(false);
  protected readonly accepting = signal<string | null>(null);

  protected readonly inviteForm = this.fb.nonNullable.group({
    email: '',
    role: 'COLABORADOR' as SpaceRole,
  });

  private readonly activeAdminsCount = computed(
    () => this.members().filter((m) => m.active && m.role === 'ADMIN').length,
  );

  constructor() {
    void this.load();
  }

  protected isLastActiveAdmin(member: TeamMember): boolean {
    return member.role === 'ADMIN' && member.active && this.activeAdminsCount() <= 1;
  }

  protected toggleInviteForm(): void {
    this.showInviteForm.update((v) => !v);
  }

  protected async submitInvite(): Promise<void> {
    const { email, role } = this.inviteForm.getRawValue();
    if (!isValidEmail(email)) {
      this.toast.error('Informe um e-mail válido.');
      return;
    }
    this.inviting.set(true);
    try {
      await this.service.invite(email, role);
      this.toast.success(
        'Convite criado. A pessoa verá o convite ao entrar no JuriFlow com este e-mail.',
      );
      this.inviteForm.reset({ email: '', role: 'COLABORADOR' });
      this.showInviteForm.set(false);
      this.pendingInvites.set(await this.service.listPendingInvites());
    } catch (err) {
      this.toast.error(friendlyError(err, 'Não foi possível enviar o convite.'));
    } finally {
      this.inviting.set(false);
    }
  }

  protected async cancelInvite(invite: SpaceInvite): Promise<void> {
    try {
      await this.service.cancelInvite(invite.id);
      this.toast.success('Convite cancelado.');
      this.pendingInvites.set(await this.service.listPendingInvites());
    } catch (err) {
      this.toast.error(friendlyError(err, 'Não foi possível cancelar o convite.'));
    }
  }

  protected async accept(invite: SpaceInvite): Promise<void> {
    if (!invite.token) return;
    this.accepting.set(invite.token);
    try {
      await this.service.acceptInvite(invite.token);
      // O novo vínculo não aparece por conta própria: refaz o contexto de auth
      // antes de recarregar, senão hasActiveSpace() continua falso.
      await this.auth.refreshContext();
      this.toast.success('Convite aceito.');
      await this.load();
    } catch (err) {
      this.toast.error(friendlyError(err, 'Não foi possível aceitar o convite.'));
    } finally {
      this.accepting.set(null);
    }
  }

  protected async changeRole(member: TeamMember, role: string): Promise<void> {
    if (role === member.role) return;
    try {
      await this.service.updateRole(member.id, role as SpaceRole);
      this.toast.success('Papel atualizado.');
      this.members.set(await this.service.listMembers());
    } catch (err) {
      this.toast.error(friendlyError(err, 'Não foi possível alterar o papel.'));
    }
  }

  protected async toggleActive(member: TeamMember): Promise<void> {
    if (member.active) {
      const confirmed = await this.dialogs.confirm({
        title: 'Desativar acesso',
        message: `${member.name} perderá o acesso a este espaço. Os processos sob sua responsabilidade continuam no espaço e podem ser transferidos.`,
        confirmLabel: 'Desativar',
        tone: 'danger',
      });
      if (!confirmed) return;
    }
    try {
      await this.service.setActive(member.id, !member.active);
      this.toast.success(member.active ? 'Acesso desativado.' : 'Acesso reativado.');
      this.members.set(await this.service.listMembers());
    } catch (err) {
      this.toast.error(friendlyError(err, 'Não foi possível atualizar o acesso.'));
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      // Sem espaço ativo (ex.: convidado recém-cadastrado): só "convites
      // recebidos" faz sentido — listMembers/listPendingInvites exigem spaceId.
      const [members, pendingInvites, myPendingInvites] = await Promise.all([
        this.hasActiveSpace() ? this.service.listMembers() : Promise.resolve([]),
        this.hasActiveSpace() && this.isAdmin()
          ? this.service.listPendingInvites()
          : Promise.resolve([]),
        this.service.listMyPendingInvites(),
      ]);
      this.members.set(members);
      this.pendingInvites.set(pendingInvites);
      this.myPendingInvites.set(myPendingInvites);
    } catch {
      this.toast.error('Não foi possível carregar a equipe.');
    } finally {
      this.loading.set(false);
    }
  }
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function friendlyError(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('já é membro ativo')) return 'Este e-mail já é membro ativo deste espaço.';
  if (message.includes('convite pendente'))
    return 'Já existe um convite pendente para este e-mail.';
  if (message.includes('ao menos um ADMIN'))
    return 'O espaço precisa manter ao menos um administrador ativo.';
  return fallback;
}
