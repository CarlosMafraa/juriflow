import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastContainerComponent } from './shared/feedback/toast-container.component';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, ToastContainerComponent],
  template: `
    <a class="skip-link" href="#main-content">Pular para o conteúdo</a>
    <router-outlet />
    <jf-toast-container />
  `,
  styles: [
    `
      .skip-link {
        position: absolute;
        left: -999px;
        top: 0;
        background: var(--jf-primary, #2563eb);
        color: #fff;
        padding: 0.5rem 1rem;
        z-index: 2000;
      }
      .skip-link:focus {
        left: 0;
      }
    `,
  ],
})
export class AppComponent {}
