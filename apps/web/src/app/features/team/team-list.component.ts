import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import type { SpaceInvite, SpaceRole } from '@juriflow/shared-types';
import { AuthService } from '../../core/auth/auth.service';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';
import { PermissionService } from '../../core/authorization/permission.service';
import { ToastService } from '../../shared/feedback/toast.service';
import { DialogService } from '../../shared/ui/dialog.service';
import { ButtonComponent } from '../../shared/ui/button.component';
import { CardComponent } from '../../shared/ui/card.component';
import { InputComponent } from '../../shared/ui/input.component';
import { SelectComponent } from '../../shared/ui/select.component';
import { BadgeComponent } from '../../shared/ui/badge.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
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
    ButtonComponent,
    CardComponent,
    InputComponent,
    SelectComponent,
    BadgeComponent,
    SpinnerComponent,
    EmptyStateComponent,
  ],
  template: `
    <header class="head">
      <h1>Equipe</h1>
      @if (hasActiveSpace() && isAdmin()) {
        <jf-button size="sm" (click)="toggleInviteForm()">
          {{ showInviteForm() ? 'Cancelar' : 'Convidar' }}
        </jf-button>
      }
    </header>

    @if (loading()) {
      <div class="center"><jf-spinner [showLabel]="true" /></div>
    } @else {
      @if (myPendingInvites().length > 0) {
        <jf-card title="Convites recebidos" class="section">
          <ul class="list">
            @for (invite of myPendingInvites(); track invite.id) {
              <li class="row">
                <div class="min0">
                  <p class="name">{{ invite.spaceName }}</p>
                  <p class="muted">
                    {{ invite.role === 'ADMIN' ? 'Administrador' : 'Colaborador' }}
                  </p>
                </div>
                <jf-button
                  size="sm"
                  [loading]="accepting() === invite.token"
                  (click)="accept(invite)"
                >
                  Aceitar
                </jf-button>
              </li>
            }
          </ul>
        </jf-card>
      }

      @if (hasActiveSpace() && isAdmin() && showInviteForm()) {
        <jf-card title="Convidar usuário" class="section">
          <form class="invite-form" [formGroup]="inviteForm" (ngSubmit)="submitInvite()">
            <jf-input
              label="E-mail"
              type="email"
              placeholder="pessoa@escritorio.com.br"
              formControlName="email"
            />
            <jf-select label="Papel" [options]="roleOptions" formControlName="role" />
            <jf-button type="submit" [loading]="inviting()">Enviar convite</jf-button>
          </form>
        </jf-card>
      }

      @if (!hasActiveSpace()) {
        <jf-empty-state
          title="Você ainda não faz parte de nenhum espaço"
          message="Aceite um convite acima, se houver, ou peça a um administrador para te convidar."
        />
      } @else {
        <jf-card title="Membros" class="section">
          @if (members().length === 0) {
            <jf-empty-state
              title="Nenhum membro"
              message="Convide pessoas para colaborar no acompanhamento dos processos."
            />
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
                      <jf-badge tone="neutral">Inativo</jf-badge>
                    }
                    @if (isAdmin()) {
                      <select
                        class="role-select"
                        [attr.aria-label]="'Papel de ' + m.name"
                        [disabled]="isLastActiveAdmin(m)"
                        (change)="changeRole(m, $any($event.target).value)"
                      >
                        @for (opt of roleOptions; track opt.value) {
                          <option [value]="opt.value" [selected]="opt.value === m.role">
                            {{ opt.label }}
                          </option>
                        }
                      </select>
                    } @else {
                      <jf-badge tone="primary">{{
                        m.role === 'ADMIN' ? 'Administrador' : 'Colaborador'
                      }}</jf-badge>
                    }
                    @if (isAdmin() && m.profileId !== currentUserId()) {
                      <jf-button
                        size="sm"
                        variant="secondary"
                        [disabled]="isLastActiveAdmin(m)"
                        (click)="toggleActive(m)"
                      >
                        {{ m.active ? 'Desativar' : 'Reativar' }}
                      </jf-button>
                    }
                  </div>
                </li>
              }
            </ul>
          }
        </jf-card>

        @if (isAdmin()) {
          <jf-card title="Convites pendentes" class="section">
            @if (pendingInvites().length === 0) {
              <jf-empty-state
                title="Nenhum convite pendente"
                message="Use o botão Convidar para adicionar alguém ao espaço."
              />
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
                    <jf-button size="sm" variant="ghost" (click)="cancelInvite(invite)"
                      >Cancelar</jf-button
                    >
                  </li>
                }
              </ul>
            }
          </jf-card>
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
      .section {
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
        font: inherit;
        min-width: 11rem;
        padding: 0.4rem 0.6rem;
        border: 1px solid var(--jf-border, #cbd5e1);
        border-radius: var(--jf-radius, 8px);
        background: var(--jf-surface, #fff);
        color: var(--jf-text, #0f172a);
      }
      .role-select:disabled {
        background: var(--jf-surface-muted, #f1f5f9);
        opacity: 0.7;
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
