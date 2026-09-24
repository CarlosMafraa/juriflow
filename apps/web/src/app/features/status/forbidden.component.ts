import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';

@Component({
  selector: 'jf-forbidden',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ButtonModule, CardModule],
  template: `
    <div class="wrap">
      <p-card>
        <div class="content">
          <i class="pi pi-lock" aria-hidden="true"></i>
          <h1>Acesso negado</h1>
          <p>
            Você não tem permissão para acessar esta área. Se acha que isto é um engano, fale com
            um administrador do seu espaço.
          </p>
          <a routerLink="/"><p-button severity="secondary" [outlined]="true" icon="pi pi-arrow-left" label="Voltar ao início" /></a>
        </div>
      </p-card>
    </div>
  `,
  styles: [
    `
      .wrap {
        display: flex;
        justify-content: center;
        padding: 3rem 1rem;
      }
      .content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        text-align: center;
        max-width: 26rem;
      }
      .content i {
        font-size: 2rem;
        color: var(--jf-text-muted, #64748b);
      }
      .content h1 {
        margin: 0.25rem 0;
        font-size: 1.2rem;
      }
      .content p {
        margin: 0 0 0.75rem;
        color: var(--jf-text-muted, #64748b);
        font-size: 0.9rem;
      }
    `,
  ],
})
export class ForbiddenComponent {}
