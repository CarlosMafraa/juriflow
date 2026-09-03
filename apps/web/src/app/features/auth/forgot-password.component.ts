import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { AlertComponent } from '../../shared/ui/alert.component';
import { ButtonComponent } from '../../shared/ui/button.component';
import { InputComponent } from '../../shared/ui/input.component';
import { AuthCardComponent } from './auth-card.component';

@Component({
  selector: 'jf-forgot-password',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlertComponent,
    ButtonComponent,
    InputComponent,
    AuthCardComponent,
  ],
  template: `
    <jf-auth-card title="Recuperar acesso">
      @if (sent()) {
        <jf-alert tone="success">
          Se existir uma conta para esse e-mail, você receberá um link para redefinir a senha.
        </jf-alert>
        <a class="link" routerLink="/login">Voltar para o login</a>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()" class="form">
          <p class="hint">Informe seu e-mail e enviaremos um link de redefinição.</p>
          <jf-input label="E-mail" type="email" autocomplete="username" formControlName="email" />
          <jf-button type="submit" [loading]="loading()" block>Enviar link</jf-button>
          <a class="link" routerLink="/login">Voltar para o login</a>
        </form>
      }
    </jf-auth-card>
  `,
  styles: [
    `
      .form {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .hint {
        margin: 0;
        font-size: 0.85rem;
        color: var(--jf-text-muted, #64748b);
      }
      .link {
        text-align: center;
        display: block;
        margin-top: 1rem;
        font-size: 0.85rem;
        color: var(--jf-primary, #2563eb);
      }
    `,
  ],
})
export class ForgotPasswordComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);

  protected readonly loading = signal(false);
  protected readonly sent = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    try {
      const redirectTo = `${window.location.origin}/redefinir-senha`;
      await this.auth.sendPasswordReset(this.form.getRawValue().email, redirectTo);
    } catch {
      // Não revela se o e-mail existe.
    } finally {
      this.loading.set(false);
      this.sent.set(true);
    }
  }
}
