import type { AuditActorType, AuditResult } from './audit.js';
import type { SpaceMemberStatus, SpaceRole } from './roles.js';

/** ISO-8601 timestamp string (as returned by PostgREST). */
export type IsoDateTime = string;
export type Uuid = string;

/** 1:1 com `auth.users`. Dados de identidade do usuário. */
export interface Profile {
  id: Uuid;
  fullName: string | null;
  email: string;
  /** E.164 quando presente. Ver DP-19. */
  phone: string | null;
  isSuperAdmin: boolean;
  avatarUrl: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime | null;
}

/** Tenant. Um escritório / organização. */
export interface Space {
  id: Uuid;
  name: string;
  slug: string;
  status: 'active' | 'suspended';
  createdBy: Uuid | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime | null;
}

/** Vínculo usuário <-> espaço, com papel. */
export interface SpaceMember {
  id: Uuid;
  spaceId: Uuid;
  profileId: Uuid;
  role: SpaceRole;
  status: SpaceMemberStatus;
  invitedBy: Uuid | null;
  invitedAt: IsoDateTime | null;
  acceptedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime | null;
}

/** Registro imutável da trilha de auditoria. */
export interface AuditLog {
  id: Uuid;
  spaceId: Uuid | null;
  actorId: Uuid | null;
  actorType: AuditActorType;
  action: string;
  entityType: string | null;
  entityId: string | null;
  result: AuditResult;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  createdAt: IsoDateTime;
}
