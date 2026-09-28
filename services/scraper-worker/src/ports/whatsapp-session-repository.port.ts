export type WhatsappSessionStatus =
  'disconnected' | 'connecting' | 'qr_ready' | 'connected' | 'failed';

export interface WhatsappSessionRow {
  readonly spaceId: string;
  readonly sessionName: string;
  readonly status: WhatsappSessionStatus;
  readonly pendingAction: 'connect' | 'disconnect' | null;
}

/** Persistência de `whatsapp_sessions` — só o polling job escreve aqui (service_role). */
export interface WhatsappSessionRepository {
  /** Linhas com trabalho pendente: `pending_action` setado ou ainda em transição. */
  listActionable(): Promise<readonly WhatsappSessionRow[]>;
  markConnecting(spaceId: string): Promise<void>;
  markQrReady(spaceId: string, qrCode: string): Promise<void>;
  /** Sessões dadas como conectadas — conferidas de tempos em tempos no WAHA. */
  listConnected(): Promise<readonly WhatsappSessionRow[]>;
  markConnected(spaceId: string): Promise<void>;
  /** Marca conectada como ainda viva (só atualiza last_checked_at). */
  touchConnected(spaceId: string): Promise<void>;
  /** `reason` aparece na tela quando a queda não foi pedida pelo ADMIN. */
  markDisconnected(spaceId: string, reason?: string): Promise<void>;
  markFailed(spaceId: string, error: string): Promise<void>;
}
