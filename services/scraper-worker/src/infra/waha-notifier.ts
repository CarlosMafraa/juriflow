import type { Notifier } from '../ports/notifier.port.js';
import { wahaSessionNameForSpace } from './waha-session-name.js';

/**
 * Cliente HTTP mínimo do WAHA (RN seção 38: respeitar a doc oficial da versão
 * usada — `POST /api/sendText` é o endpoint estável do core da API).
 * Desacoplado do pipeline por trás da porta `Notifier` (RN seção 9).
 *
 * Uma sessão WAHA por espaço (RN seção 22) — o nome vem de `spaceId`, nunca
 * fixo, para nunca enviar pela sessão de outro tenant.
 */
export class WahaNotifier implements Notifier {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async sendText(spaceId: string, phone: string, message: string): Promise<void> {
    const session = wahaSessionNameForSpace(spaceId);
    const chatId = toWahaChatId(phone);
    const response = await fetch(`${this.baseUrl}/api/sendText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.apiKey,
      },
      body: JSON.stringify({ session, chatId, text: message }),
      // Sem timeout, um WAHA travado prende a coleta inteira no envio.
      signal: AbortSignal.timeout(30_000),
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
