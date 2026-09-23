import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../../core/auth/auth.service';
import { Logger } from '../../core/observability/logger';
import { AuthCardComponent } from './auth-card.component';

@Component({
  selector: 'jf-login',
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
    <jf-auth-card title="Entrar no JuriFlow">
      <form [formGroup]="form" (ngSubmit)="submit()" class="form">
        @if (error()) {
          <p-message severity="error" [text]="error()" styleClass="w-full" />
        }
        <div class="field">
          <label for="email">E-mail</label>
          <input
            pInputText
            id="email"
            type="email"
            autocomplete="username"
            formControlName="email"
          />
          @if (fieldError('email')) {
            <small class="field__error">{{ fieldError('email') }}</small>
          }
        </div>
        <div class="field">
          <label for="password">Senha</label>
          <input
            pInputText
            id="password"
            type="password"
            autocomplete="current-password"
            formControlName="password"
          />
          @if (fieldError('password')) {
            <small class="field__error">{{ fieldError('password') }}</small>
          }
        </div>
        <p-button
          type="submit"
          label="Entrar"
          [loading]="loading()"
          [disabled]="loading()"
          styleClass="w-full"
        />
        <a class="form__link" routerLink="/recuperar-senha">Esqueci minha senha</a>
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
      .form__link {
        text-align: center;
        font-size: 0.85rem;
        color: var(--jf-primary, #2563eb);
      }
      :host ::ng-deep .w-full {
        width: 100%;
      }
    `,
  ],
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly logger = inject(Logger);

  protected readonly loading = signal(false);
  protected readonly error = signal('');

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  protected fieldError(name: 'email' | 'password'): string {
    const control = this.form.controls[name];
    if (!control.touched || control.valid) return '';
    if (control.hasError('required')) return 'Campo obrigatório.';
    if (control.hasError('email')) return 'E-mail inválido.';
    if (control.hasError('minlength')) return 'Mínimo de 6 caracteres.';
    return 'Valor inválido.';
  }

  protected async submit(): Promise<void> {
    this.error.set('');
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    try {
      const { email, password } = this.form.getRawValue();
      await this.auth.signInWithPassword(email, password);
      const redirectTo = this.route.snapshot.queryParamMap.get('redirectTo') ?? '/';
      await this.router.navigateByUrl(redirectTo);
    } catch (err) {
      this.logger.warn('Falha no login', { reason: String(err) });
      this.error.set('E-mail ou senha inválidos.');
    } finally {
      this.loading.set(false);
    }
  }
}
