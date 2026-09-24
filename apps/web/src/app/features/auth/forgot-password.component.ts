import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../../core/auth/auth.service';
import { AuthCardComponent } from './auth-card.component';

@Component({
  selector: 'jf-forgot-password',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonModule,
    InputTextModule,
    MessageModule,
    AuthCardComponent,
  ],
  template: `
    <jf-auth-card title="Recuperar acesso" subtitle="Informe seu e-mail e enviaremos um link de redefinição.">
      @if (sent()) {
        <p-message severity="success" styleClass="w-full">
          Se existir uma conta para esse e-mail, você receberá um link para redefinir a senha.
        </p-message>
        <a class="link" routerLink="/login">Voltar para o login</a>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()" class="form">
          <div class="field">
            <label for="email">E-mail</label>
            <input
              pInputText
              id="email"
              type="email"
              autocomplete="username"
              formControlName="email"
            />
          </div>
          <p-button type="submit" icon="pi pi-send" label="Enviar link" [loading]="loading()" styleClass="w-full" />
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
      .link {
        text-align: center;
        display: block;
        margin-top: 1rem;
        font-size: 0.85rem;
        color: var(--jf-primary, #2563eb);
      }
      :host ::ng-deep .w-full {
        width: 100%;
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
