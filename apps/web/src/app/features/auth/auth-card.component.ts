import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CardModule } from 'primeng/card';

/** Moldura centralizada das telas públicas de autenticação (responsiva). */
@Component({
  selector: 'jf-auth-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CardModule],
  template: `
    <div class="auth">
      <p-card [header]="title" styleClass="auth__box">
        <ng-content />
      </p-card>
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
      :host ::ng-deep .auth__box {
        width: 100%;
        max-width: 22rem;
      }
      :host ::ng-deep .auth__box .p-card-title {
        text-align: center;
        font-size: 1.15rem;
      }
    `,
  ],
})
export class AuthCardComponent {
  @Input() title = '';
}
