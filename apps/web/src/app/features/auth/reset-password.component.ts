import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../../core/auth/auth.service';
import { AuthCardComponent } from './auth-card.component';

/**
 * Alvo do link de redefinição do Supabase. O SDK detecta o token na URL
 * (detectSessionInUrl) e cria uma sessão de recuperação; aqui só definimos a
 * nova senha.
 */
@Component({
  selector: 'jf-reset-password',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, ButtonModule, InputTextModule, MessageModule, AuthCardComponent],
  template: `
    <jf-auth-card title="Definir nova senha">
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
        <p-button type="submit" label="Salvar senha" [loading]="loading()" styleClass="w-full" />
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

  protected readonly loading = signal(false);
  protected readonly error = signal('');

  protected readonly form = this.fb.nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(8)]],
    confirm: ['', [Validators.required]],
  });

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
      await this.router.navigate(['/']);
    } catch {
      this.error.set('Não foi possível redefinir a senha. Solicite um novo link.');
    } finally {
      this.loading.set(false);
    }
  }
}
