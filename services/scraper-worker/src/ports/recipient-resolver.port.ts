export type RecipientType = 'responsible' | 'client';

export interface NotificationRecipient {
  readonly type: RecipientType;
  readonly phone: string;
  /** Id do cliente (`type === 'client'`) ou do perfil do responsável. */
  readonly recipientId: string;
}

/**
 * Porta que decide QUEM deve ser notificado de um processo — todos os
 * responsáveis atuais (com telefone e vínculo ativo) e clientes vinculados com
 * opt-in (RN seções 10/28).
 * Não decide follow-up (template, envio): isso é responsabilidade do notifier.
 */
export interface RecipientResolver {
  resolveRecipients(processId: string): Promise<NotificationRecipient[]>;
}
