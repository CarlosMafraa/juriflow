import type { AuditAction } from '@juriflow/domain';
import type { AuditLogEntry } from './audit.service';

/**
 * Tradução da trilha de auditoria para quem lê: o banco guarda verbos técnicos
 * estáveis (`process.client.attach`), a tela mostra "Cliente vinculado ao processo".
 */
export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  'auth.login': 'Login',
  'auth.logout': 'Logout',
  'auth.password_reset': 'Redefinição de senha',
  'space.create': 'Espaço criado',
  'space.update': 'Dados do espaço alterados',
  'space.suspend': 'Espaço suspenso',
  'space.reactivate': 'Espaço reativado',
  'space.plan.update': 'Plano alterado',
  'member.invite': 'Convite enviado',
  'member.invite.cancel': 'Convite cancelado',
  'member.accept': 'Convite aceito',
  'member.role.update': 'Papel de membro alterado',
  'member.deactivate': 'Membro desativado',
  'member.reactivate': 'Membro reativado',
  'member.remove': 'Membro removido',
  'profile.update': 'Perfil atualizado',
  'platform.super_admin.grant': 'Acesso de plataforma concedido',
  'platform.super_admin.revoke': 'Acesso de plataforma removido',
  'process.create': 'Processo cadastrado',
  'process.update': 'Processo editado',
  'process.transfer': 'Processo transferido',
  'process.archive': 'Processo arquivado',
  'process.reactivate': 'Processo reativado',
  'process.close': 'Processo encerrado',
  'process.soft_delete': 'Processo excluído',
  'process.restore': 'Processo restaurado',
  'process.responsible.add': 'Responsável incluído',
  'process.responsible.remove': 'Responsável removido',
  'process.check.request': 'Consulta ao tribunal solicitada',
  'client.create': 'Cliente cadastrado',
  'client.update': 'Cliente editado',
  'client.soft_delete': 'Cliente excluído',
  'process.client.attach': 'Cliente vinculado ao processo',
  'process.client.detach': 'Cliente desvinculado do processo',
  'court.create': 'Tribunal cadastrado',
  'court.update': 'Tribunal editado',
  'court.activate': 'Tribunal ativado',
  'court.deactivate': 'Tribunal desativado',
  'process.movement.collected': 'Movimentação coletada',
  'notification.delivery.sent': 'WhatsApp enviado',
  'notification.delivery.failed': 'Falha no envio de WhatsApp',
  'template.create': 'Template criado',
  'template.update': 'Template editado',
  'template.delete': 'Template excluído',
  'notification_config.space.create': 'Regras de notificação criadas',
  'notification_config.space.update': 'Regras de notificação alteradas',
  'notification_config.process.create': 'Notificação do processo personalizada',
  'notification_config.process.update': 'Notificação do processo alterada',
  'notification_config.process.delete': 'Processo voltou às regras do espaço',
  'waha.session.connect': 'WhatsApp: conexão solicitada',
  'waha.session.disconnect': 'WhatsApp: desconexão solicitada',
};

export const AUDIT_ENTITY_LABEL: Record<string, string> = {
  process: 'Processo',
  client: 'Cliente',
  process_client: 'Vínculo processo/cliente',
  process_movement: 'Movimentação',
  notification_delivery: 'Envio de WhatsApp',
  message_template: 'Template',
  space_notification_config: 'Regras de notificação',
  process_notification_config: 'Notificação do processo',
  space_member: 'Membro',
  space_invite: 'Convite',
  whatsapp_session: 'WhatsApp',
  space: 'Espaço',
  court: 'Tribunal',
  profile: 'Perfil',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABEL[action as AuditAction] ?? action;
}

export function auditActorLabel(entry: AuditLogEntry): string {
  if (entry.actorName) return entry.actorName;
  return entry.actorType === 'system' ? 'Sistema (automático)' : 'Usuário removido';
}

/**
 * O que foi afetado, em linguagem de gente: o número do processo, o nome do
 * cliente, o e-mail do convite... tirado do próprio registro (before/after).
 */
export function auditEntityLabel(entry: AuditLogEntry): string {
  const kind = entry.entityType ? (AUDIT_ENTITY_LABEL[entry.entityType] ?? entry.entityType) : '';
  const data = { ...(entry.before ?? {}), ...(entry.after ?? {}) } as Record<string, unknown>;
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = data[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
  };
  let detail =
    entry.entityName || pick('cnj_number', 'internal_ref', 'name', 'email', 'description');
  if (detail && detail.length > 60) detail = `${detail.slice(0, 57)}…`;
  return [kind, detail].filter(Boolean).join(' · ') || '—';
}
