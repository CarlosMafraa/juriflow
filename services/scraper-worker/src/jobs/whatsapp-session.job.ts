import type { Logger } from '../infra/logger.js';
import type { WahaSessionGateway } from '../infra/waha-session-gateway.js';
import type {
  WhatsappSessionRepository,
  WhatsappSessionRow,
} from '../ports/whatsapp-session-repository.port.js';

/** Mensagem para o ADMIN quando a sessão cai sem ele pedir (ex.: saiu pelo celular). */
export const SESSION_LOST_MESSAGE =
  'O WhatsApp foi desconectado fora do JuriFlow (por exemplo, pelo celular em "Aparelhos conectados"). Conecte de novo para voltar a enviar os avisos.';

/**
 * Polling do ciclo de vida das sessões WhatsApp por espaço (RN seção 22 /
 * F12). O ADMIN só grava a intenção (`pending_action`, via RPC); este job é
 * quem de fato fala com o WAHA e sincroniza status/QR de volta.
 */
export class WhatsappSessionJob {
  private running = false;
  private checking = false;

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

  /**
   * Confere no WAHA as sessões dadas como conectadas: quem desconecta pelo
   * celular não passa pelo app, e sem isto a tela mostraria "Conectado" para
   * sempre (e os avisos falhariam em silêncio).
   */
  async checkConnected(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      const rows = await this.repository.listConnected();
      for (const row of rows) {
        try {
          await this.checkRow(row);
        } catch (error) {
          // WAHA fora do ar não prova que a sessão caiu: tenta de novo depois.
          this.logger.warn('Não foi possível conferir a sessão WhatsApp.', {
            spaceId: row.spaceId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      this.checking = false;
    }
  }

  private async checkRow(row: WhatsappSessionRow): Promise<void> {
    const status = await this.gateway.getStatus(row.sessionName);
    if (status === 'WORKING') {
      await this.repository.touchConnected(row.spaceId);
      return;
    }
    if (status === 'STARTING') return; // WAHA reiniciando: ainda sobe sozinha.
    if (status === 'STOPPED') {
      // WAHA reiniciado (ex.: PC religado) volta com a sessão parada, mas a
      // autenticação continua válida: religa em vez de pedir QR de novo.
      this.logger.info('Sessão WhatsApp parada no WAHA — religando.', { spaceId: row.spaceId });
      await this.gateway.start(row.sessionName);
      return;
    }

    // SCAN_QR_CODE / FAILED / inexistente: a autenticação foi perdida.
    this.logger.warn('Sessão WhatsApp caiu fora do app — marcando como desconectada.', {
      spaceId: row.spaceId,
      wahaStatus: status ?? 'inexistente',
    });
    if (status !== null) await this.gateway.logoutAndDelete(row.sessionName);
    await this.repository.markDisconnected(row.spaceId, SESSION_LOST_MESSAGE);
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
