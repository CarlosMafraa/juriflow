export type RecipientType = 'responsible' | 'client';

export interface NotificationRecipient {
  readonly type: RecipientType;
  readonly phone: string;
  /** Presente só quando `type === 'client'`. */
  readonly clientId: string | null;
}

/**
 * Porta que decide QUEM deve ser notificado de um processo — responsável
 * atual (sempre, se tiver telefone) e clientes vinculados com opt-in (RN seções 10/28).
 * Não decide follow-up (template, envio): isso é responsabilidade do notifier.
 */
export interface RecipientResolver {
  resolveRecipients(processId: string): Promise<NotificationRecipient[]>;
}
