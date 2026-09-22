import type { Notifier } from '../ports/notifier.port.js';

/**
 * Cliente HTTP mínimo do WAHA (RN seção 38: respeitar a doc oficial da versão
 * usada — `POST /api/sendText` é o endpoint estável do core da API).
 * Desacoplado do pipeline por trás da porta `Notifier` (RN seção 9).
 */
export class WahaNotifier implements Notifier {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly session: string,
  ) {}

  async sendText(phone: string, message: string): Promise<void> {
    const chatId = toWahaChatId(phone);
    const response = await fetch(`${this.baseUrl}/api/sendText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.apiKey,
      },
      body: JSON.stringify({ session: this.session, chatId, text: message }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`WAHA respondeu ${response.status} ao enviar para ${chatId}: ${body}`);
    }
  }
}

/** Converte E.164 ("+5592...") para o formato de chatId do WAHA ("5592...@c.us"). */
function toWahaChatId(e164Phone: string): string {
  const digitsOnly = e164Phone.replace(/^\+/, '');
  return `${digitsOnly}@c.us`;
}
