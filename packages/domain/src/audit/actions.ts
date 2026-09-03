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

  memberInvite: 'member.invite',
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

  clientCreate: 'client.create',
  clientUpdate: 'client.update',
  clientSoftDelete: 'client.soft_delete',

  processClientAttach: 'process.client.attach',
  processClientDetach: 'process.client.detach',

  courtCreate: 'court.create',
  courtUpdate: 'court.update',
  courtActivate: 'court.activate',
  courtDeactivate: 'court.deactivate',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
