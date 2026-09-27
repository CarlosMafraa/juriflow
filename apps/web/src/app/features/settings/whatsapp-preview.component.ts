import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DEFAULT_MESSAGE_TEMPLATE } from '@juriflow/shared-types';

/** Dados de exemplo da prévia — não é envio real, só a aparência da mensagem. */
const SAMPLE: Record<string, string> = {
  numero_processo: '0001234-56.2026.8.04.0001',
  movimentacao: 'Juntada de petição pelo autor.',
  data: '24/09/2026',
  nome: 'Maria',
  escritorio: 'Silva & Associados',
};

/** Texto do template com os placeholders trocados pelo exemplo. */
export function renderMessagePreview(body: string): string {
  return Object.entries(SAMPLE).reduce(
    (text, [key, value]) => text.replaceAll(`{{${key}}}`, value),
    body,
  );
}

/** Corpo do template escolhido, ou o padrão do sistema quando não há escolha. */
export function templateBodyOrDefault(body: string | null | undefined): string {
  return body ?? DEFAULT_MESSAGE_TEMPLATE.body;
}

/**
 * Como a mensagem chega no WhatsApp, com os placeholders já substituídos por
 * um exemplo. Só visual.
 */
@Component({
  selector: 'jf-whatsapp-preview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wa-preview">
      <div class="wa-preview__header">
        <span class="wa-preview__avatar"><i class="pi pi-user" aria-hidden="true"></i></span>
        <p class="wa-preview__name">{{ title() }}</p>
      </div>
      <div class="wa-preview__chat">
        @if (text().trim()) {
          <div class="wa-bubble">
            <p>{{ text() }}</p>
            <span class="wa-bubble__meta">
              09:41
              <i class="pi pi-check" aria-hidden="true"></i
              ><i class="pi pi-check" aria-hidden="true"></i>
            </span>
          </div>
        } @else {
          <p class="wa-preview__empty">{{ emptyText() }}</p>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .wa-preview {
        height: 100%;
        display: flex;
        flex-direction: column;
        border-radius: 1rem;
        overflow: hidden;
        box-shadow: var(--jf-shadow-card);
      }
      .wa-preview__header {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        padding: 0.6rem 0.9rem;
        background: var(--jf-primary, #1f385d);
        color: #fff;
      }
      .wa-preview__avatar {
        width: 2rem;
        height: 2rem;
        border-radius: 999px;
        background: rgb(255 255 255 / 20%);
        display: grid;
        place-items: center;
        font-size: 0.9rem;
      }
      .wa-preview__name {
        margin: 0;
        font-weight: 600;
        font-size: 0.9rem;
      }
      .wa-preview__chat {
        flex: 1;
        min-height: 10rem;
        background: #e5ddd5;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
      }
      .wa-preview__empty {
        margin: 0;
        font-size: 0.8rem;
        color: #667781;
        text-align: center;
      }
      .wa-bubble {
        align-self: flex-end;
        max-width: 88%;
        background: #dcf8c6;
        border-radius: 0.5rem;
        padding: 0.45rem 0.55rem 0.35rem;
        box-shadow: 0 1px 1px rgb(0 0 0 / 10%);
      }
      .wa-bubble p {
        margin: 0;
        font-size: 0.85rem;
        white-space: pre-wrap;
        color: #111b21;
      }
      .wa-bubble__meta {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        margin-top: 0.15rem;
        font-size: 0.68rem;
        color: #667781;
      }
      .wa-bubble__meta .pi-check {
        font-size: 0.65rem;
        color: #53bdeb;
      }
      .wa-bubble__meta .pi-check + .pi-check {
        margin-left: -0.4rem;
      }
    `,
  ],
})
export class WhatsappPreviewComponent {
  readonly title = input.required<string>();
  /** Texto já renderizado (use `renderMessagePreview`). */
  readonly text = input.required<string>();
  readonly emptyText = input('Digite a mensagem para ver como ela vai aparecer no WhatsApp.');
}
