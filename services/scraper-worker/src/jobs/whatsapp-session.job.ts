import type { Logger } from '../infra/logger.js';
import type { WahaSessionGateway } from '../infra/waha-session-gateway.js';
import type {
  WhatsappSessionRepository,
  WhatsappSessionRow,
} from '../ports/whatsapp-session-repository.port.js';

/**
 * Polling do ciclo de vida das sessões WhatsApp por espaço (RN seção 22 /
 * F12). O ADMIN só grava a intenção (`pending_action`, via RPC); este job é
 * quem de fato fala com o WAHA e sincroniza status/QR de volta.
 */
export class WhatsappSessionJob {
  private running = false;

  constructor(
    private readonly gateway: WahaSessionGateway,
    private readonly repository: WhatsappSessionRepository,
    private readonly logger: Logger,
  ) {}

  async tick(): Promise<void> {
    // O intervalo é curto (5s) e o WAHA pode demorar: sem esta trava, dois
    // ticks processariam a mesma linha (ex.: iniciar a sessão duas vezes).
    if (this.running) return;
    this.running = true;
    try {
      const rows = await this.repository.listActionable();
      for (const row of rows) {
        try {
          await this.processRow(row);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error('Falha ao processar sessão WhatsApp.', {
            spaceId: row.spaceId,
            error: message,
          });
          await this.repository.markFailed(row.spaceId, message);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async processRow(row: WhatsappSessionRow): Promise<void> {
    if (row.pendingAction === 'disconnect') {
      await this.gateway.logoutAndDelete(row.sessionName);
      await this.repository.markDisconnected(row.spaceId);
      return;
    }

    if (row.pendingAction === 'connect') {
      await this.gateway.start(row.sessionName);
      await this.repository.markConnecting(row.spaceId);
      return; // próximo tick lê o status já com a sessão em progresso
    }

    // Sem ação pendente: linha em transição (connecting/qr_ready) — segue o status real.
    const status = await this.gateway.getStatus(row.sessionName);
    if (status === 'WORKING') {
      await this.repository.markConnected(row.spaceId);
    } else if (status === 'SCAN_QR_CODE') {
      const qrCode = await this.gateway.getQrBase64(row.sessionName);
      await this.repository.markQrReady(row.spaceId, qrCode);
    } else if (status === 'FAILED' || status === null) {
      await this.repository.markFailed(
        row.spaceId,
        `Sessão WAHA em estado inesperado: ${status ?? 'inexistente'}.`,
      );
    }
    // STARTING/STOPPED: ainda subindo — sem-op, próximo tick reavalia.
  }
}
