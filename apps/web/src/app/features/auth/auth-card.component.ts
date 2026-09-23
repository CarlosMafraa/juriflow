import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CardModule } from 'primeng/card';

/**
 * Moldura das telas públicas de autenticação: painel de marca (desktop) +
 * card central. Visual replicado do protótipo de referência (litigio-link-main).
 */
@Component({
  selector: 'jf-auth-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CardModule],
  template: `
    <div class="shell">
      <div class="brand">
        <div class="brand__logo">
          <span class="brand__mark pi pi-building-columns"></span>
          <span class="brand__name">JuriFlow</span>
        </div>
        <div class="brand__pitch">
          <h2>Acompanhamento processual com notificação automática</h2>
          <p>
            Processos, clientes, movimentações e avisos por WhatsApp organizados por espaço de
            trabalho, com auditoria completa.
          </p>
        </div>
        <p class="brand__legal">Dados pessoais tratados conforme a LGPD.</p>
      </div>

      <div class="panel">
        <div class="panel__mobile-logo">
          <span class="brand__mark pi pi-building-columns"></span>
          <span class="brand__name">JuriFlow</span>
        </div>

        <p-card styleClass="panel__card">
          <header class="panel__header">
            <h1>{{ title }}</h1>
            @if (subtitle) {
              <p>{{ subtitle }}</p>
            }
          </header>
          <ng-content />
        </p-card>
      </div>
    </div>
  `,
  styles: [
    `
      .shell {
        min-height: 100vh;
        display: grid;
        grid-template-columns: 1fr;
      }
      @media (min-width: 1024px) {
        .shell {
          grid-template-columns: 1fr 1fr;
        }
      }
      .brand {
        display: none;
        flex-direction: column;
        justify-content: space-between;
        padding: 3rem;
        color: var(--jf-navy-foreground, #fff);
        background: var(--jf-brand-gradient);
      }
      @media (min-width: 1024px) {
        .brand {
          display: flex;
        }
      }
      .brand__logo {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }
      .brand__mark {
        display: grid;
        place-items: center;
        width: 2.5rem;
        height: 2.5rem;
        border-radius: var(--jf-radius-lg);
        background: var(--jf-gold);
        color: var(--jf-gold-foreground);
        font-size: 1.15rem;
      }
      .brand__name {
        font-family: var(--jf-font-display);
        font-weight: 600;
        font-size: 1.15rem;
        letter-spacing: -0.01em;
      }
      .brand__pitch {
        max-width: 26rem;
      }
      .brand__pitch h2 {
        font-family: var(--jf-font-display);
        font-size: 1.75rem;
        font-weight: 600;
        letter-spacing: -0.015em;
        margin: 0 0 1rem;
      }
      .brand__pitch p {
        margin: 0;
        font-size: 0.9rem;
        opacity: 0.82;
        line-height: 1.6;
      }
      .brand__legal {
        margin: 0;
        font-size: 0.75rem;
        opacity: 0.65;
      }
      .panel {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 2.5rem 1.25rem;
        background: var(--jf-bg, #f8fafc);
      }
      .panel__mobile-logo {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        margin-bottom: 1.5rem;
      }
      @media (min-width: 1024px) {
        .panel__mobile-logo {
          display: none;
        }
      }
      :host ::ng-deep .panel__card {
        width: 100%;
        max-width: 26rem;
        box-shadow: var(--jf-shadow-card);
        border-radius: var(--jf-radius-lg);
      }
      .panel__header {
        margin-bottom: 1.25rem;
      }
      .panel__header h1 {
        font-family: var(--jf-font-display);
        font-size: 1.4rem;
        font-weight: 600;
        letter-spacing: -0.01em;
        margin: 0 0 0.35rem;
      }
      .panel__header p {
        margin: 0;
        font-size: 0.85rem;
        color: var(--jf-text-muted, #64748b);
      }
      /* Cor de marca só nestas telas — não é o tema global do PrimeNG. */
      :host ::ng-deep .panel__card .p-button:not(.p-button-outlined):not(.p-button-text) {
        background: var(--jf-navy);
        border-color: var(--jf-navy);
      }
      :host ::ng-deep .panel__card .p-button:not(.p-button-outlined):not(.p-button-text):not(:disabled):hover {
        background: oklch(0.28 0.07 258);
        border-color: oklch(0.28 0.07 258);
      }
    `,
  ],
})
export class AuthCardComponent {
  @Input() title = '';
  @Input() subtitle = '';
}
