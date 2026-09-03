import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { ButtonComponent } from '../../shared/ui/button.component';

@Component({
  selector: 'jf-not-found',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EmptyStateComponent, ButtonComponent],
  template: `
    <jf-empty-state title="Página não encontrada" message="O endereço acessado não existe.">
      <span empty-icon>🧭</span>
      <a empty-action routerLink="/"><jf-button variant="secondary">Voltar ao início</jf-button></a>
    </jf-empty-state>
  `,
})
export class NotFoundComponent {}
