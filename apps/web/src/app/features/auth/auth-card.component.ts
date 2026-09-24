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

        <div class="panel__card-wrap">
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
      .panel__card-wrap {
        width: 100%;
        max-width: 26rem;
      }
      :host ::ng-deep .panel__card {
        width: 100%;
        box-shadow: var(--jf-shadow-card);
        border-radius: 1rem;
        /* Campos/botões desta tela usam as métricas do protótipo (shadcn Input/Button:
           h-9, px-3, rounded-md) via os tokens compartilhados do PrimeNG. */
        --p-form-field-padding-x: 0.75rem;
        --p-form-field-padding-y: 0.375rem;
        --p-form-field-border-radius: 0.625rem;
        --p-button-padding-x: 1rem;
        --p-button-padding-y: 0.375rem;
      }
      .panel__header {
        margin-bottom: 1.25rem;
      }
      .panel__header h1 {
        font-family: var(--jf-font-display);
        font-size: 1.5rem;
        font-weight: 600;
        letter-spacing: -0.015em;
        margin: 0 0 0.35rem;
      }
      .panel__header p {
        margin: 0;
        font-size: 0.875rem;
        color: var(--jf-text-muted, #64748b);
      }
      /* Campos: mesma tipografia/altura do Input do protótipo (h-9, text-sm). */
      :host ::ng-deep .panel__card .field {
        gap: 0.5rem;
      }
      :host ::ng-deep .panel__card .field > label {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--jf-text, #0f172a);
      }
      :host ::ng-deep .panel__card input.p-inputtext {
        height: 2.25rem;
        font-size: 0.875rem;
        box-shadow: 0 1px 2px 0 rgb(0 0 0 / 5%);
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
      :host ::ng-deep .panel__card .p-button {
        height: 2.25rem;
        font-size: 0.875rem;
        font-weight: 500;
      }
    `,
  ],
})
export class AuthCardComponent {
  @Input() title = '';
  @Input() subtitle = '';
}
