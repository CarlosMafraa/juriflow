export type WhatsappSessionStatus = 'disconnected' | 'connecting' | 'qr_ready' | 'connected' | 'failed';

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
  markConnected(spaceId: string): Promise<void>;
  markDisconnected(spaceId: string): Promise<void>;
  markFailed(spaceId: string, error: string): Promise<void>;
}
