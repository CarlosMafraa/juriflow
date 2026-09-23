/** Porta de envio — hoje é o WAHA, mas o pipeline não sabe disso (ADR-0004, seção 9 das RN). */
export interface Notifier {
  /**
   * Envia pela sessão WhatsApp do espaço (uma sessão WAHA por `spaceId` — RN
   * seção 22). @throws se o envio falhar. Quem chama decide o que fazer com a falha.
   */
  sendText(spaceId: string, phone: string, message: string): Promise<void>;
}
