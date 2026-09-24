import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ThemeService } from './core/theming/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, ToastModule, ConfirmDialogModule],
  template: `
    <a class="skip-link" href="#main-content">Pular para o conteúdo</a>
    <router-outlet />
    <p-toast />
    <p-confirmDialog />
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
export class AppComponent {
  // Injetado só para instanciar cedo (aplica a classe de modo escuro antes da
  // 1ª tela renderizar) — o serviço não expõe nada que este componente use.
  private readonly theme = inject(ThemeService);
}
