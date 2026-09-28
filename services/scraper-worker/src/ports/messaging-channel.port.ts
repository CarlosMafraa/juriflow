/**
 * Diz se o canal de envio do espaço (a sessão WhatsApp) está conectado.
 * Sem canal, o pipeline nem tenta enviar: o aviso fica pendente, sem gastar
 * tentativas, e sai quando o WhatsApp conectar (regra N11).
 */
export interface MessagingChannel {
  isConnected(spaceId: string): Promise<boolean>;
}
