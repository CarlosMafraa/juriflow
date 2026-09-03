import type { IsoDateTime, Uuid } from './entities.js';

export const PROCESS_STATUSES = ['active', 'archived', 'closed'] as const;
export type ProcessStatus = (typeof PROCESS_STATUSES)[number];

export const CLIENT_TYPES = ['PF', 'PJ'] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export const COURT_TYPES = [
  'STF',
  'STJ',
  'TST',
  'TSE',
  'STM',
  'CNJ',
  'TRF',
  'TJ',
  'TRT',
  'TRE',
  'TJM',
  'turma_recursal',
  'outro',
] as const;
export type CourtType = (typeof COURT_TYPES)[number];

export const RESPONSIBILITY_REASONS = ['process_created', 'transfer'] as const;
export type ResponsibilityReason = (typeof RESPONSIBILITY_REASONS)[number];

/** Catálogo global de tribunais. Sem `space_id`. */
export interface Court {
  id: Uuid;
  name: string;
  type: CourtType;
  jurisdiction: string;
  datajudCode: string | null;
  active: boolean;
  createdBy: Uuid | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime | null;
}

/** Processo jurídico. `assignedUserId` = responsável atual; `createdBy` = quem cadastrou. */
export interface Process {
  id: Uuid;
  spaceId: Uuid;
  cnjNumber: string | null;
  internalRef: string | null;
  courtId: Uuid;
  assignedUserId: Uuid;
  createdBy: Uuid;
  status: ProcessStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime | null;
  deletedAt: IsoDateTime | null;
}

export interface ProcessResponsibleHistoryEntry {
  id: Uuid;
  spaceId: Uuid;
  processId: Uuid;
  /** Responsável naquele período. */
  responsibleId: Uuid;
  /** Quem realizou a atribuição/transferência (só histórico/auditoria). */
  assignedBy: Uuid | null;
  reason: ResponsibilityReason;
  startedAt: IsoDateTime;
  endedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export interface Client {
  id: Uuid;
  spaceId: Uuid;
  type: ClientType;
  name: string;
  /** CPF/CNPJ normalizado (só dígitos). */
  document: string | null;
  email: string | null;
  phone: string | null;
  birthDate: string | null;
  notificationOptIn: boolean;
  optInAt: IsoDateTime | null;
  createdBy: Uuid;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime | null;
  deletedAt: IsoDateTime | null;
}

/** Vínculo processo↔cliente. Sem papel processual. */
export interface ProcessClient {
  id: Uuid;
  spaceId: Uuid;
  processId: Uuid;
  clientId: Uuid;
  createdBy: Uuid;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime | null;
  deletedAt: IsoDateTime | null;
}
