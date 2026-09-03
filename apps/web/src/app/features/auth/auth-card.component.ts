import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/** Moldura centralizada das telas públicas de autenticação (responsiva). */
@Component({
  selector: 'jf-auth-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth">
      <div class="auth__box">
        <h1 class="auth__title">{{ title }}</h1>
        <ng-content />
      </div>
    </div>
  `,
  styles: [
    `
      .auth {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
        background: var(--jf-bg, #f8fafc);
      }
      .auth__box {
        width: 100%;
        max-width: 22rem;
        background: var(--jf-surface, #fff);
        border: 1px solid var(--jf-border, #e2e8f0);
        border-radius: var(--jf-radius-lg, 12px);
        padding: 1.75rem;
        box-shadow: 0 10px 40px rgb(15 23 42 / 8%);
      }
      .auth__title {
        margin: 0 0 1.25rem;
        font-size: 1.15rem;
        text-align: center;
      }
    `,
  ],
})
export class AuthCardComponent {
  @Input() title = '';
}
