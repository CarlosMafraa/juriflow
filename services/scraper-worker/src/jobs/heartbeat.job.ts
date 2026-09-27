import type { Logger } from '../infra/logger.js';
import type { WorkerStatusReporter } from '../ports/worker-status.port.js';

/**
 * Batimento do worker (regra P10), a cada minuto:
 *   1. grava em `worker_status` — o painel da plataforma mostra online/parado;
 *   2. "pinga" o monitor externo (HEALTHCHECK_PING_URL, ex.: Healthchecks.io).
 *      Se os pings param, é o MONITOR que avisa (e-mail/Telegram/WhatsApp):
 *      um worker parado não conseguiria avisar ninguém.
 */
export class HeartbeatJob {
  constructor(
    private readonly status: WorkerStatusReporter,
    private readonly logger: Logger,
    private readonly pingUrl: string | null,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async tick(): Promise<void> {
    await this.status
      .heartbeat()
      .catch((error) =>
        this.logger.warn('Batimento não gravado no banco.', { error: String(error) }),
      );
    if (!this.pingUrl) return;
    await this.fetchFn(this.pingUrl, { method: 'GET', signal: AbortSignal.timeout(10_000) })
      .then((r) => {
        if (!r.ok) this.logger.warn('Monitor externo recusou o ping.', { status: r.status });
      })
      .catch((error) => this.logger.warn('Monitor externo inacessível.', { error: String(error) }));
  }
}
