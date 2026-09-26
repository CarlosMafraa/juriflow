import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { AuthService } from '../../core/auth/auth.service';
import { PASSWORD_HINT, passwordValidators } from '../../core/auth/password-policy';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';
import { ProfileService } from '../profile/profile.service';
import { TeamService, type InviteOpening } from '../team/team.service';
import { AuthCardComponent } from './auth-card.component';

const PHONE_E164 = /^\+[1-9]\d{6,14}$/;

type View = 'loading' | 'blocked' | 'form';

/**
 * Destino do link de convite (e do redirecionamento de quem ainda não
 * configurou o escritório). Marca o convite como aberto, pede os dados da
 * pessoa — e, para o ADMIN de um escritório novo, o nome do escritório — e
 * aceita o convite. Link vencido (24 h) ou substituído por um reenvio não passa.
 */
@Component({
  selector: 'jf-first-access',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonModule,
    InputTextModule,
    MessageModule,
    ProgressSpinnerModule,
    AuthCardComponent,
  ],
  template: `
    @switch (view()) {
      @case ('loading') {
        <jf-auth-card title="Abrindo seu convite…">
          <div class="center"><p-progressSpinner styleClass="spinner-sm" /></div>
        </jf-auth-card>
      }
      @case ('blocked') {
        <jf-auth-card [title]="blockedTitle()">
          <p class="lead">{{ blockedText() }}</p>
          <a routerLink="/login" class="form__link">Ir para o login</a>
        </jf-auth-card>
      }
      @default {
        <jf-auth-card
          title="Bem-vindo ao JuriFlow"
          [subtitle]="
            office()
              ? 'Complete seus dados e os do seu escritório para começar.'
              : 'Complete seus dados para começar.'
          "
        >
          <form [formGroup]="form" (ngSubmit)="submit()" class="form">
            @if (error()) {
              <p-message severity="error" [text]="error()" styleClass="w-full" />
            }

            @if (office()) {
              <fieldset>
                <legend>Seu escritório</legend>
                <div class="field">
                  <label for="officeName">Nome do escritório</label>
                  <input
                    pInputText
                    id="officeName"
                    formControlName="officeName"
                    autocomplete="organization"
                  />
                </div>
              </fieldset>
            }

            <fieldset>
              <legend>Seus dados</legend>
              <div class="field">
                <label for="fullName">Nome completo</label>
                <input pInputText id="fullName" formControlName="fullName" autocomplete="name" />
              </div>
              <div class="field">
                <label for="phone">Telefone (WhatsApp)</label>
                <input
                  pInputText
                  id="phone"
                  formControlName="phone"
                  placeholder="+5592999999999"
                  autocomplete="tel"
                />
                <small [class]="phoneInvalid() ? 'field__error' : 'field__hint'">
                  Opcional. Formato internacional, ex.: +5592999999999.
                </small>
              </div>
              @if (needsPassword()) {
                <div class="field">
                  <label for="password">Crie uma senha</label>
                  <input
                    pInputText
                    id="password"
                    type="password"
                    formControlName="password"
                    autocomplete="new-password"
                  />
                  <small [class]="passwordInvalid() ? 'field__error' : 'field__hint'">{{
                    passwordHint
                  }}</small>
                </div>
                <div class="field">
                  <label for="confirm">Confirme a senha</label>
                  <input
                    pInputText
                    id="confirm"
                    type="password"
                    formControlName="confirm"
                    autocomplete="new-password"
                  />
                  @if (mismatch()) {
                    <small class="field__error">As senhas não conferem.</small>
                  }
                </div>
              }
            </fieldset>

            <p-button
              type="submit"
              icon="pi pi-check"
              [label]="office() ? 'Salvar e entrar no escritório' : 'Salvar e entrar'"
              [loading]="saving()"
              styleClass="w-full"
            />
          </form>
        </jf-auth-card>
      }
    }
  `,
  styles: [
    `
      .form {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      fieldset {
        border: 0;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
      }
      legend {
        font-size: 0.8125rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: var(--jf-text-muted, #64748b);
        margin-bottom: 0.25rem;
      }
      .lead {
        margin: 0 0 1rem;
        line-height: 1.5;
      }
      .center {
        display: flex;
        justify-content: center;
        padding: 1.5rem;
      }
      :host ::ng-deep .spinner-sm {
        width: 2.5rem;
        height: 2.5rem;
      }
      :host ::ng-deep .w-full {
        width: 100%;
      }
    `,
  ],
})
export class FirstAccessComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly activeSpace = inject(ActiveSpaceService);
  private readonly team = inject(TeamService);
  private readonly profiles = inject(ProfileService);
  private readonly router = inject(Router);
  private readonly params = inject(ActivatedRoute).snapshot.queryParamMap;

  private readonly inviteId = this.params.get('convite');
  protected readonly needsPassword = signal(this.params.get('nova') === '1');
  protected readonly passwordHint = PASSWORD_HINT;

  protected readonly view = signal<View>('loading');
  protected readonly blockedTitle = signal('');
  protected readonly blockedText = signal('');
  protected readonly office = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  private opening: InviteOpening | null = null;
  private spaceId: string | null = null;

  protected readonly form = this.fb.nonNullable.group({
    officeName: [''],
    fullName: ['', [Validators.required, Validators.minLength(3)]],
    phone: ['', [Validators.pattern(PHONE_E164)]],
    password: [''],
    confirm: [''],
  });

  constructor() {
    void this.start();
  }

  protected phoneInvalid(): boolean {
    const c = this.form.controls.phone;
    return c.invalid && (c.touched || c.dirty);
  }

  protected passwordInvalid(): boolean {
    const c = this.form.controls.password;
    return c.invalid && (c.touched || c.dirty);
  }

  protected mismatch(): boolean {
    const { password, confirm } = this.form.getRawValue();
    return !!confirm && password !== confirm;
  }

  private block(title: string, text: string): void {
    this.blockedTitle.set(title);
    this.blockedText.set(text);
    this.view.set('blocked');
  }

  private async start(): Promise<void> {
    // Sem sessão = o Auth recusou o link (vencido, substituído ou já usado).
    if (!this.auth.isAuthenticated()) {
      this.block(
        'Link inválido',
        'Este link não vale mais: ele expira em 24 horas e deixa de funcionar quando um convite mais recente é enviado. Peça um novo convite a quem convidou você.',
      );
      return;
    }

    if (this.inviteId) {
      try {
        this.opening = await this.team.openInvite(this.inviteId);
      } catch {
        this.block(
          'Convite de outra conta',
          'Este convite não é para a conta com que você entrou. Saia e abra o link do e-mail que recebeu o convite.',
        );
        return;
      }
      const state = this.opening.state;
      if (state === 'superseded') {
        this.block(
          'Link substituído',
          'Um convite mais recente foi enviado para você, e só o último link funciona. Abra o e-mail mais recente.',
        );
        return;
      }
      if (state === 'expired') {
        this.block(
          'Convite expirado',
          'Este convite venceu (o link vale 24 horas). Peça um novo convite.',
        );
        return;
      }
      if (state === 'cancelled') {
        this.block('Convite cancelado', 'Este convite foi cancelado por quem enviou.');
        return;
      }
      this.spaceId = this.opening.spaceId;
      this.office.set(this.opening.role === 'ADMIN' && this.opening.setupPending);
    } else {
      // Sem convite de escritório: ADMIN com escritório ainda não configurado
      // (redirecionado ao entrar) ou conta criada por convite que ainda não
      // concluiu o primeiro acesso (ex.: o SUPER_ADMIN criado pelo bootstrap).
      const space = this.activeSpace.activeSpace() ?? this.activeSpace.availableSpaces()[0];
      const officePending = !!space?.setupPending && space.role === 'ADMIN';
      const notOnboarded = !this.auth.context()?.profile?.onboardedAt;
      if (!officePending && !notOnboarded) {
        await this.router.navigateByUrl('/');
        return;
      }
      if (notOnboarded) this.needsPassword.set(true);
      if (officePending && space) {
        this.spaceId = space.id;
        this.office.set(true);
      }
    }

    const profile = this.auth.context()?.profile;
    this.form.patchValue({ fullName: profile?.fullName ?? '', phone: profile?.phone ?? '' });
    if (this.office())
      this.form.controls.officeName.setValidators([Validators.required, Validators.minLength(2)]);
    if (this.needsPassword()) {
      this.form.controls.password.setValidators(passwordValidators);
      this.form.controls.confirm.setValidators([Validators.required]);
    }
    this.form.updateValueAndValidity();
    this.view.set('form');
  }

  protected async submit(): Promise<void> {
    this.error.set('');
    if (this.form.invalid || this.mismatch()) {
      this.form.markAllAsTouched();
      Object.values(this.form.controls).forEach((c) => c.markAsDirty());
      return;
    }
    const v = this.form.getRawValue();
    const userId = this.auth.userId();
    if (!userId) return;

    this.saving.set(true);
    try {
      if (this.needsPassword()) await this.auth.updatePassword(v.password);
      await this.profiles.updateProfile(userId, {
        fullName: v.fullName,
        phone: v.phone.trim() || null,
      });
      await this.profiles.markOnboarded(userId);
      if (this.inviteId && this.opening?.state === 'opened') {
        await this.team.acceptInviteById(this.inviteId);
      }
      if (this.office() && this.spaceId) {
        await this.team.completeSpaceSetup(this.spaceId, v.officeName);
      }
      await this.auth.refreshContext();
      if (this.spaceId) this.activeSpace.setActiveSpace(this.spaceId);
      await this.router.navigateByUrl('/');
    } catch (err) {
      const message = (err as { message?: string })?.message ?? '';
      this.error.set(
        message.includes('expirou')
          ? 'Este convite venceu enquanto você preenchia. Peça um novo convite.'
          : 'Não foi possível salvar. Confira os dados e tente de novo.',
      );
    } finally {
      this.saving.set(false);
    }
  }
}
