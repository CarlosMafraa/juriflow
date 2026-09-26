import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../../core/auth/auth.service';
import { AuthCardComponent } from './auth-card.component';
import { PASSWORD_HINT, passwordValidators } from '../../core/auth/password-policy';

/**
 * Alvo do link de redefinição E do link de convite (`?convite=1`, Edge
 * Function send-invite) do Supabase. O SDK detecta o token na URL
 * (detectSessionInUrl) e cria a sessão; aqui só definimos a senha.
 */
@Component({
  selector: 'jf-reset-password',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, ButtonModule, InputTextModule, MessageModule, AuthCardComponent],
  template: `
    <jf-auth-card
      [title]="isInvite ? 'Bem-vindo ao JuriFlow' : 'Definir nova senha'"
      [subtitle]="
        isInvite
          ? 'Crie sua senha para acessar o sistema.'
          : 'Escolha uma nova senha para sua conta.'
      "
    >
      <form [formGroup]="form" (ngSubmit)="submit()" class="form">
        @if (error()) {
          <p-message severity="error" [text]="error()" styleClass="w-full" />
        }
        <div class="field">
          <label for="password">Nova senha</label>
          <input
            pInputText
            id="password"
            type="password"
            autocomplete="new-password"
            formControlName="password"
          />
          <small [class]="showPasswordError() ? 'field__error' : 'field__hint'">{{
            passwordHint
          }}</small>
        </div>
        <div class="field">
          <label for="confirm">Confirmar senha</label>
          <input
            pInputText
            id="confirm"
            type="password"
            autocomplete="new-password"
            formControlName="confirm"
          />
          @if (mismatch()) {
            <small class="field__error">As senhas não conferem.</small>
          }
        </div>
        <p-button
          type="submit"
          icon="pi pi-key"
          [label]="isInvite ? 'Criar senha e entrar' : 'Salvar senha'"
          [loading]="loading()"
          styleClass="w-full"
        />
      </form>
    </jf-auth-card>
  `,
  styles: [
    `
      .form {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      :host ::ng-deep .w-full {
        width: 100%;
      }
    `,
  ],
})
export class ResetPasswordComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly isInvite = inject(ActivatedRoute).snapshot.queryParamMap.has('convite');
  protected readonly passwordHint = PASSWORD_HINT;

  protected readonly loading = signal(false);
  protected readonly error = signal('');

  protected readonly form = this.fb.nonNullable.group({
    password: ['', passwordValidators],
    confirm: ['', [Validators.required]],
  });

  protected showPasswordError(): boolean {
    const c = this.form.controls.password;
    return c.invalid && (c.touched || c.dirty);
  }

  protected mismatch(): boolean {
    const { password, confirm } = this.form.getRawValue();
    return !!confirm && password !== confirm;
  }

  protected async submit(): Promise<void> {
    this.error.set('');
    if (this.form.invalid || this.mismatch()) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    try {
      await this.auth.updatePassword(this.form.getRawValue().password);
      // Convidado cai direto em Equipe, onde aceita o convite pendente.
      await this.router.navigate([this.isInvite ? '/configuracoes/usuarios' : '/']);
    } catch {
      this.error.set(
        this.isInvite
          ? 'Não foi possível criar a senha. O link pode ter expirado — peça um novo convite.'
          : 'Não foi possível redefinir a senha. Solicite um novo link.',
      );
    } finally {
      this.loading.set(false);
    }
  }
}
