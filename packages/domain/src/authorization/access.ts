import type { EffectiveRole } from '@juriflow/shared-types';
import { isPlatformPermission, PERMISSION_MATRIX, type Permission } from './permissions.js';
import { type AuthSubject } from './subject.js';

export class AuthorizationError extends Error {
  readonly code = 'FORBIDDEN';
  constructor(
    public readonly permission: Permission,
    public readonly spaceId?: string,
  ) {
    super(
      spaceId
        ? `Não autorizado: '${permission}' no espaço '${spaceId}'.`
        : `Não autorizado: '${permission}'.`,
    );
    this.name = 'AuthorizationError';
  }
}

export interface AccessOptions {
  /** Obrigatório para permissões com escopo de espaço. */
  spaceId?: string;
}

/**
 * Papel efetivo do usuário para fins de permissão.
 * - SUPER_ADMIN quando `isSuperAdmin` (independe de espaço).
 * - Caso contrário, o papel do vínculo ATIVO no `spaceId` informado.
 * - `null` quando não há papel aplicável.
 */
export function effectiveRole(subject: AuthSubject, spaceId?: string): EffectiveRole | null {
  if (subject.isSuperAdmin) {
    return 'SUPER_ADMIN';
  }
  if (!spaceId) {
    return null;
  }
  const membership = subject.memberships.find(
    (m) => m.spaceId === spaceId && m.status === 'active',
  );
  return membership?.role ?? null;
}

/**
 * Decisão central de autorização. Toda checagem de permissão do backend e do
 * frontend deve passar por aqui (direta ou indiretamente).
 */
export function can(
  subject: AuthSubject,
  permission: Permission,
  options: AccessOptions = {},
): boolean {
  if (!isPlatformPermission(permission) && !options.spaceId) {
    // Permissão com escopo de espaço exige `spaceId` — falha fechada.
    return false;
  }

  const role = effectiveRole(subject, options.spaceId);
  if (!role) {
    return false;
  }

  // SUPER_ADMIN nunca ganha permissões fora da sua matriz, mesmo com spaceId.
  return PERMISSION_MATRIX[role].includes(permission);
}

/** Igual a {@link can}, mas lança {@link AuthorizationError} quando negado. */
export function assertCan(
  subject: AuthSubject,
  permission: Permission,
  options: AccessOptions = {},
): void {
  if (!can(subject, permission, options)) {
    throw new AuthorizationError(permission, options.spaceId);
  }
}
