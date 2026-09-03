import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { AlertComponent } from '../../shared/ui/alert.component';
import { ButtonComponent } from '../../shared/ui/button.component';
import { InputComponent } from '../../shared/ui/input.component';
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
  imports: [
    ReactiveFormsModule,
    AlertComponent,
    ButtonComponent,
    InputComponent,
    AuthCardComponent,
  ],
  template: `
    <jf-auth-card title="Definir nova senha">
      <form [formGroup]="form" (ngSubmit)="submit()" class="form">
        @if (error()) {
          <jf-alert tone="danger">{{ error() }}</jf-alert>
        }
        <jf-input
          label="Nova senha"
          type="password"
          autocomplete="new-password"
          formControlName="password"
        />
        <jf-input
          label="Confirmar senha"
          type="password"
          autocomplete="new-password"
          formControlName="confirm"
          [error]="mismatch() ? 'As senhas não conferem.' : ''"
        />
        <jf-button type="submit" [loading]="loading()" block>Salvar senha</jf-button>
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
