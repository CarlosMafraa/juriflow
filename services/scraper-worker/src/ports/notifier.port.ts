/** Porta de envio — hoje é o WAHA, mas o pipeline não sabe disso (ADR-0004, seção 9 das RN). */
export interface Notifier {
  /** @throws se o envio falhar. Quem chama decide o que fazer com a falha. */
  sendText(phone: string, message: string): Promise<void>;
}
