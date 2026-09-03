import type { SpaceMemberStatus, SpaceRole } from '@juriflow/shared-types';

/** Vínculo (relevante para autorização) do usuário com um espaço. */
export interface SpaceMembership {
  spaceId: string;
  role: SpaceRole;
  status: SpaceMemberStatus;
}

/**
 * Conjunto mínimo de fatos sobre o usuário autenticado necessários para
 * decidir autorização. É montado a partir do token + perfil + `space_members`
 * e NÃO deve conter dados operacionais.
 */
export interface AuthSubject {
  userId: string;
  isSuperAdmin: boolean;
  memberships: readonly SpaceMembership[];
}

export function isActiveMember(subject: AuthSubject, spaceId: string): boolean {
  return subject.memberships.some((m) => m.spaceId === spaceId && m.status === 'active');
}

/** Espaços em que o usuário tem vínculo ativo. SUPER_ADMIN não é membro automático de nada. */
export function activeSpaceIds(subject: AuthSubject): string[] {
  return subject.memberships.filter((m) => m.status === 'active').map((m) => m.spaceId);
}
