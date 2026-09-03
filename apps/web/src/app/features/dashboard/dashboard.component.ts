import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';
import { CardComponent } from '../../shared/ui/card.component';
import { BadgeComponent } from '../../shared/ui/badge.component';

@Component({
  selector: 'jf-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CardComponent, BadgeComponent],
  template: `
    <header class="page-head">
      <h1>Olá{{ name() ? ', ' + name() : '' }}</h1>
      <p class="muted">
        @if (space()) {
          Espaço ativo: <strong>{{ space()!.name }}</strong>
          <jf-badge tone="primary">{{ space()!.role }}</jf-badge>
        } @else if (isSuperAdmin()) {
          <jf-badge tone="primary">SUPER_ADMIN</jf-badge> — você administra a plataforma.
        } @else {
          Você ainda não faz parte de nenhum espaço.
        }
      </p>
    </header>

    <section class="grid">
      <jf-card title="Processos">
        <p class="metric">—</p>
        <p class="muted">Disponível na fase de Processos.</p>
      </jf-card>
      <jf-card title="Movimentações recentes">
        <p class="metric">—</p>
        <p class="muted">Disponível na fase de Acompanhamento.</p>
      </jf-card>
      <jf-card title="Notificações enviadas">
        <p class="metric">—</p>
        <p class="muted">Disponível na fase de Notificações.</p>
      </jf-card>
    </section>
  `,
  styles: [
    `
      .page-head h1 {
        margin: 0 0 0.25rem;
        font-size: 1.35rem;
      }
      .muted {
        color: var(--jf-text-muted, #64748b);
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .grid {
        display: grid;
        gap: 1rem;
        margin-top: 1.25rem;
        grid-template-columns: 1fr;
      }
      .metric {
        font-size: 1.75rem;
        font-weight: 800;
        margin: 0 0 0.25rem;
      }
      @media (min-width: 768px) {
        .grid {
          grid-template-columns: repeat(2, 1fr);
        }
      }
      @media (min-width: 1024px) {
        .grid {
          grid-template-columns: repeat(3, 1fr);
        }
      }
    `,
  ],
})
export class DashboardComponent {
  private readonly auth = inject(AuthService);
  private readonly activeSpace = inject(ActiveSpaceService);

  protected readonly name = computed(
    () => this.auth.context()?.profile?.fullName?.split(' ')[0] ?? '',
  );
  protected readonly space = computed(() => this.activeSpace.activeSpace());
  protected readonly isSuperAdmin = computed(() => this.auth.authSubject()?.isSuperAdmin ?? false);
}
