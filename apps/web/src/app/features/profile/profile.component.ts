import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../shared/feedback/toast.service';
import { ButtonComponent } from '../../shared/ui/button.component';
import { CardComponent } from '../../shared/ui/card.component';
import { InputComponent } from '../../shared/ui/input.component';
import { ProfileService } from './profile.service';

const PHONE_E164 = /^\+[1-9]\d{6,14}$/;

@Component({
  selector: 'jf-profile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, ButtonComponent, CardComponent, InputComponent],
  template: `
    <header class="head"><h1>Meu perfil</h1></header>

    <div class="grid">
      <jf-card title="Dados pessoais">
        <form class="form" [formGroup]="profileForm" (ngSubmit)="submitProfile()">
          <jf-input
            label="Nome completo"
            formControlName="fullName"
            [required]="true"
            [error]="showProfileError('fullName') ? 'Informe seu nome completo.' : ''"
          />
          <jf-input
            label="Telefone"
            type="tel"
            formControlName="phone"
            hint="Formato E.164, ex.: +5592999999999"
            [error]="phoneError()"
          />
          <jf-input
            label="E-mail de acesso"
            formControlName="email"
            hint="Não pode ser alterado por aqui."
          />
          <div class="actions">
            <jf-button type="submit" [loading]="savingProfile()">Salvar alterações</jf-button>
          </div>
        </form>
      </jf-card>

      <jf-card title="Segurança">
        <form class="form" [formGroup]="passwordForm" (ngSubmit)="submitPassword()">
          <jf-input
            label="Nova senha"
            type="password"
            autocomplete="new-password"
            formControlName="password"
            [error]="showPasswordError('password') ? 'Mínimo de 6 caracteres.' : ''"
          />
          <jf-input
            label="Confirmar nova senha"
            type="password"
            autocomplete="new-password"
            formControlName="confirm"
            [error]="confirmError()"
          />
          <div class="actions">
            <jf-button type="submit" variant="secondary" [loading]="changingPassword()">
              Alterar senha
            </jf-button>
          </div>
        </form>
      </jf-card>
    </div>
  `,
  styles: [
    `
      .head h1 {
        margin: 0 0 1rem;
        font-size: 1.35rem;
      }
      .grid {
        display: grid;
        gap: 1rem;
        max-width: 60rem;
      }
      @media (min-width: 900px) {
        .grid {
          grid-template-columns: 1fr 1fr;
          align-items: start;
        }
      }
      .form {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
      }
    `,
  ],
})
export class ProfileComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly profileService = inject(ProfileService);
  private readonly toast = inject(ToastService);

  protected readonly savingProfile = signal(false);
  protected readonly changingPassword = signal(false);

  protected readonly profileForm = this.fb.nonNullable.group({
    fullName: ['', [Validators.required, Validators.minLength(3)]],
    phone: '',
    email: [''],
  });

  protected readonly passwordForm = this.fb.nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(6)]],
    confirm: '',
  });

  constructor() {
    const profile = this.auth.context()?.profile;
    this.profileForm.setValue({
      fullName: profile?.fullName ?? '',
      phone: profile?.phone ?? '',
      email: profile?.email ?? '',
    });
    this.profileForm.controls.email.disable();
  }

  protected showProfileError(name: 'fullName'): boolean {
    const c = this.profileForm.controls[name];
    return c.touched && c.invalid;
  }

  protected showPasswordError(name: 'password'): boolean {
    const c = this.passwordForm.controls[name];
    return c.touched && c.invalid;
  }

  protected phoneError(): string {
    const p = this.profileForm.value.phone?.trim();
    if (!p) return '';
    return PHONE_E164.test(p) ? '' : 'Use o formato E.164 (ex.: +5592999999999).';
  }

  protected confirmError(): string {
    const { password, confirm } = this.passwordForm.value;
    if (!confirm) return '';
    return password === confirm ? '' : 'As senhas não coincidem.';
  }

  protected async submitProfile(): Promise<void> {
    if (this.profileForm.invalid || this.phoneError()) {
      this.profileForm.markAllAsTouched();
      return;
    }
    const userId = this.auth.userId();
    if (!userId) return;
    this.savingProfile.set(true);
    try {
      const { fullName, phone } = this.profileForm.getRawValue();
      await this.profileService.updateProfile(userId, { fullName, phone: phone.trim() || null });
      await this.auth.refreshContext();
      this.toast.success('Perfil atualizado.');
    } catch {
      this.toast.error('Não foi possível salvar o perfil.');
    } finally {
      this.savingProfile.set(false);
    }
  }

  protected async submitPassword(): Promise<void> {
    if (this.passwordForm.invalid || this.confirmError()) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    this.changingPassword.set(true);
    try {
      const { password } = this.passwordForm.getRawValue();
      await this.auth.updatePassword(password);
      this.passwordForm.reset({ password: '', confirm: '' });
      this.toast.success('Senha alterada com sucesso.');
    } catch {
      this.toast.error('Não foi possível alterar a senha.');
    } finally {
      this.changingPassword.set(false);
    }
  }
}
