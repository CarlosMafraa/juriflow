export interface CatchupRequest {
  readonly processId: string;
  /** Usado ao limpar: pedido feito durante o envio não se perde. */
  readonly requestedAt: string;
  /** Sincronização ainda ligada? Desligada depois do pedido = descarta sem enviar. */
  readonly trackingEnabled: boolean;
}

/**
 * Fila de "avisos pendentes" (`notification_catchup_requests`, migração 0046):
 * processos em que algo mudou (configuração, destinatários, WhatsApp
 * conectou) e que precisam conferir/enviar avisos sem consultar o tribunal.
 */
export interface NotificationCatchupQueue {
  /** Pedidos mais antigos primeiro. */
  list(limit: number): Promise<readonly CatchupRequest[]>;
  /** Tira o pedido da fila, desde que não tenha sido renovado depois de lido. */
  clear(request: CatchupRequest): Promise<void>;
}
