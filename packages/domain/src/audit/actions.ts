/**
 * Catálogo de ações auditáveis da fundação. Verbos namespaced e estáveis —
 * são gravados em `audit_logs.action`. Novas ações de negócio entram aqui nas
 * fases seguintes.
 */
export const AUDIT_ACTIONS = {
  authLogin: 'auth.login',
  authLogout: 'auth.logout',
  authPasswordReset: 'auth.password_reset',

  spaceCreate: 'space.create',
  spaceUpdate: 'space.update',
  spaceSuspend: 'space.suspend',
  spaceReactivate: 'space.reactivate',
  spacePlanUpdate: 'space.plan.update',

  memberInvite: 'member.invite',
  memberInviteCancel: 'member.invite.cancel',
  memberAccept: 'member.accept',
  memberRoleUpdate: 'member.role.update',
  memberDeactivate: 'member.deactivate',
  memberReactivate: 'member.reactivate',
  memberRemove: 'member.remove',

  profileUpdate: 'profile.update',
  superAdminGrant: 'platform.super_admin.grant',
  superAdminRevoke: 'platform.super_admin.revoke',

  // Fase 3 — processos, clientes, tribunais (gravados por gatilhos AFTER e RPCs)
  processCreate: 'process.create',
  processUpdate: 'process.update',
  processTransfer: 'process.transfer',
  processArchive: 'process.archive',
  processReactivate: 'process.reactivate',
  processClose: 'process.close',
  processSoftDelete: 'process.soft_delete',
  processRestore: 'process.restore',
  processResponsibleAdd: 'process.responsible.add',
  processResponsibleRemove: 'process.responsible.remove',

  clientCreate: 'client.create',
  clientUpdate: 'client.update',
  clientSoftDelete: 'client.soft_delete',

  processClientAttach: 'process.client.attach',
  processClientDetach: 'process.client.detach',

  courtCreate: 'court.create',
  courtUpdate: 'court.update',
  courtActivate: 'court.activate',
  courtDeactivate: 'court.deactivate',

  // MVP Acompanhamento — coleta (scraper-worker) e notificações WhatsApp
  processCheckRequest: 'process.check.request',
  processMovementCollected: 'process.movement.collected',
  notificationDeliverySent: 'notification.delivery.sent',
  notificationDeliveryFailed: 'notification.delivery.failed',

  // Motor de notificações configurável — templates + config geral/por processo
  templateCreate: 'template.create',
  templateUpdate: 'template.update',
  templateDelete: 'template.delete',
  spaceNotificationConfigCreate: 'notification_config.space.create',
  spaceNotificationConfigUpdate: 'notification_config.space.update',
  processNotificationConfigCreate: 'notification_config.process.create',
  processNotificationConfigUpdate: 'notification_config.process.update',
  processNotificationConfigDelete: 'notification_config.process.delete',

  // Sessão WhatsApp (WAHA) por espaço — RN seção 22 / F12.
  whatsappSessionConnect: 'waha.session.connect',
  whatsappSessionDisconnect: 'waha.session.disconnect',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
