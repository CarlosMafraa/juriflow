import type { Profile, SpaceMemberStatus, SpaceRole } from '@juriflow/shared-types';

export interface Membership {
  spaceId: string;
  role: SpaceRole;
  status: SpaceMemberStatus;
  spaceName: string | null;
}

export interface AuthContext {
  userId: string;
  email: string;
  profile: Profile | null;
  memberships: Membership[];
}

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';
