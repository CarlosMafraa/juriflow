import type { Notifier } from '../ports/notifier.port.js';
import { wahaSessionNameForSpace } from './waha-session-name.js';

const WAHA_TIMEOUT_MS = 30_000;

export interface WahaNotifierOptions {
  /**
   * Pausa aleatória entre duas mensagens quaisquer (docs do WAHA, "How to
   * avoid blocking": 30–60 s entre mensagens para o mesmo contato). Vale para
   * o worker inteiro, não só dentro de um processo.
   */
  readonly minIntervalMs?: number;
  readonly maxIntervalMs?: number;
  /** Injetáveis para os testes não esperarem de verdade. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** "Digitando…" proporcional ao tamanho do texto, entre 2 e 8 s. */
export function typingDurationMs(message: string): number {
  return Math.min(8_000, Math.max(2_000, message.length * 40));
}

/**
 * Cliente HTTP mínimo do WAHA (RN seção 38: respeitar a doc oficial da versão
 * usada — `POST /api/sendText` é o endpoint estável do core da API).
 * Desacoplado do pipeline por trás da porta `Notifier` (RN seção 9).
 *
 * Uma sessão WAHA por espaço (RN seção 22) — o nome vem de `spaceId`, nunca
 * fixo, para nunca enviar pela sessão de outro tenant.
 *
 * O número cadastrado não é, necessariamente, o endereço da conta: celular
 * brasileiro antigo está no WhatsApp SEM o nono dígito (cadastro "+55 92
 * 98527-6297", conta 559285276297), e o WhatsApp novo endereça por LID. Por
 * isso, antes de enviar, pergunta ao WAHA (`/api/contacts/check-exists`) qual
 * é o chat daquele número — e guarda a resposta enquanto o worker roda.
 *
 * Anti-bloqueio (docs do WAHA): pausa aleatória entre mensagens e, antes de
 * cada uma, "digitando…" por um tempo proporcional ao texto.
 */
export class WahaNotifier implements Notifier {
  private readonly chatIds = new Map<string, string>();
  private lastSentAt: number | null = null;
  private readonly minIntervalMs: number;
  private readonly maxIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    options: WahaNotifierOptions = {},
  ) {
    this.minIntervalMs = options.minIntervalMs ?? 30_000;
    this.maxIntervalMs = Math.max(this.minIntervalMs, options.maxIntervalMs ?? 60_000);
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  async sendText(spaceId: string, phone: string, message: string): Promise<void> {
    const session = wahaSessionNameForSpace(spaceId);
    const chatId = await this.resolveChatId(session, phone);

    await this.waitTurn();
    await this.post('/api/startTyping', { session, chatId }).catch(() => undefined);
    await this.sleep(typingDurationMs(message));
    await this.post('/api/stopTyping', { session, chatId }).catch(() => undefined);

    const response = await fetch(`${this.baseUrl}/api/sendText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.apiKey,
      },
      body: JSON.stringify({ session, chatId, text: message }),
      // Sem timeout, um WAHA travado prende a coleta inteira no envio.
      signal: AbortSignal.timeout(WAHA_TIMEOUT_MS),
    });

    this.lastSentAt = this.now();
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`WAHA respondeu ${response.status} ao enviar para ${chatId}: ${body}`);
    }
  }

  /** Espera o intervalo aleatório desde a última mensagem enviada. */
  private async waitTurn(): Promise<void> {
    if (this.lastSentAt === null) return;
    const interval =
      this.minIntervalMs + Math.floor(this.random() * (this.maxIntervalMs - this.minIntervalMs));
    const remaining = this.lastSentAt + interval - this.now();
    if (remaining > 0) await this.sleep(remaining);
  }

  private async post(path: string, body: unknown): Promise<void> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': this.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(WAHA_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`WAHA respondeu ${response.status} em ${path}`);
  }

  private async resolveChatId(session: string, e164Phone: string): Promise<string> {
    const digits = e164Phone.replace(/\D/g, '');
    const cacheKey = `${session}|${digits}`;
    const cached = this.chatIds.get(cacheKey);
    if (cached) return cached;

    const url = new URL(`${this.baseUrl}/api/contacts/check-exists`);
    url.searchParams.set('phone', digits);
    url.searchParams.set('session', session);
    const response = await fetch(url, {
      headers: { 'X-Api-Key': this.apiKey },
      signal: AbortSignal.timeout(WAHA_TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`WAHA respondeu ${response.status} ao verificar ${e164Phone}: ${body}`);
    }
    const result = (await response.json()) as { numberExists?: boolean; chatId?: string | null };
    if (!result.numberExists || !result.chatId) {
      throw new Error(`O número ${e164Phone} não tem conta no WhatsApp.`);
    }
    this.chatIds.set(cacheKey, result.chatId);
    return result.chatId;
  }
}
