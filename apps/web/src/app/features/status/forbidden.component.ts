import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { ButtonComponent } from '../../shared/ui/button.component';

@Component({
  selector: 'jf-forbidden',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EmptyStateComponent, ButtonComponent],
  template: `
    <jf-empty-state
      title="Acesso negado"
      message="Você não tem permissão para acessar esta área. Se acha que isto é um engano, fale com um administrador do seu espaço."
    >
      <span empty-icon>🔒</span>
      <a empty-action routerLink="/"><jf-button variant="secondary">Voltar ao início</jf-button></a>
    </jf-empty-state>
  `,
})
export class ForbiddenComponent {}
