/** Quem originou uma ação registrada em `audit_logs`. */
export const AUDIT_ACTOR_TYPES = ['user', 'system', 'job'] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

/** Resultado de uma ação auditada. */
export const AUDIT_RESULTS = ['success', 'failure'] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];
