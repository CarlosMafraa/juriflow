import type { Profile, SpaceMemberStatus, SpaceRole } from '@juriflow/shared-types';

export interface Membership {
  spaceId: string;
  role: SpaceRole;
  status: SpaceMemberStatus;
  spaceName: string | null;
  /** Espaço suspenso pela administração da plataforma: vínculo sem nenhum acesso. */
  spaceSuspended: boolean;
  /** Escritório criado pela plataforma que o ADMIN ainda não configurou. */
  spaceSetupPending: boolean;
}

export interface AuthContext {
  userId: string;
  email: string;
  profile: Profile | null;
  memberships: Membership[];
}

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';
