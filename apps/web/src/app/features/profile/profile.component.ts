import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../shared/feedback/toast.service';
import { ProfileService } from './profile.service';

const PHONE_E164 = /^\+[1-9]\d{6,14}$/;

@Component({
  selector: 'jf-profile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, ButtonModule, CardModule, InputTextModule],
  template: `
    <header class="head"><h1>Meu perfil</h1></header>

    <div class="grid">
      <p-card header="Dados pessoais">
        <div class="avatar-row">
          @if (avatarUrl()) {
            <img [src]="avatarUrl()" alt="Foto de perfil" class="avatar" />
          } @else {
            <span class="avatar avatar--placeholder pi pi-user"></span>
          }
          <div>
            <input
              #fileInput
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              (change)="onAvatarSelected($event)"
            />
            <p-button
              type="button"
              size="small"
              severity="secondary"
              [outlined]="true"
              [loading]="uploadingAvatar()"
              label="Alterar foto"
              (onClick)="fileInput.click()"
            />
            <p class="field__hint">PNG, JPEG ou WebP.</p>
          </div>
        </div>

        <form class="form" [formGroup]="profileForm" (ngSubmit)="submitProfile()">
          <div class="field">
            <label for="fullName">Nome completo</label>
            <input pInputText id="fullName" formControlName="fullName" />
            @if (showProfileError('fullName')) {
              <small class="field__error">Informe seu nome completo.</small>
            }
          </div>
          <div class="field">
            <label for="phone">Telefone</label>
            <input pInputText id="phone" type="tel" formControlName="phone" />
            @if (phoneError()) {
              <small class="field__error">{{ phoneError() }}</small>
            } @else {
              <small class="field__hint">Formato E.164, ex.: +5592999999999</small>
            }
          </div>
          <div class="field">
            <label for="email">E-mail de acesso</label>
            <input pInputText id="email" formControlName="email" />
            <small class="field__hint">Não pode ser alterado por aqui.</small>
          </div>
          <div class="actions">
            <p-button type="submit" label="Salvar alterações" [loading]="savingProfile()" />
          </div>
        </form>
      </p-card>

      <p-card header="Segurança">
        <form class="form" [formGroup]="passwordForm" (ngSubmit)="submitPassword()">
          <div class="field">
            <label for="password">Nova senha</label>
            <input pInputText id="password" type="password" autocomplete="new-password" formControlName="password" />
            @if (showPasswordError('password')) {
              <small class="field__error">Mínimo de 6 caracteres.</small>
            }
          </div>
          <div class="field">
            <label for="confirm">Confirmar nova senha</label>
            <input pInputText id="confirm" type="password" autocomplete="new-password" formControlName="confirm" />
            @if (confirmError()) {
              <small class="field__error">{{ confirmError() }}</small>
            }
          </div>
          <div class="actions">
            <p-button type="submit" severity="secondary" [outlined]="true" [loading]="changingPassword()" label="Alterar senha" />
          </div>
        </form>
      </p-card>
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
      .avatar-row {
        display: flex;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1.25rem;
      }
      .avatar {
        width: 3.5rem;
        height: 3.5rem;
        border-radius: 999px;
        object-fit: cover;
        border: 1px solid var(--jf-border, #e2e8f0);
      }
      .avatar--placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--jf-bg, #f1f5f9);
        color: var(--jf-text-muted, #64748b);
        font-size: 1.5rem;
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
  protected readonly uploadingAvatar = signal(false);
  protected readonly avatarUrl = signal<string | null>(null);

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
    this.avatarUrl.set(profile?.avatarUrl ?? null);
  }

  protected async onAvatarSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const userId = this.auth.userId();
    if (!userId) return;

    this.uploadingAvatar.set(true);
    try {
      const url = await this.profileService.uploadAvatar(userId, file);
      this.avatarUrl.set(url);
      await this.auth.refreshContext();
      this.toast.success('Foto de perfil atualizada.');
    } catch {
      this.toast.error('Não foi possível atualizar a foto de perfil.');
    } finally {
      this.uploadingAvatar.set(false);
    }
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
