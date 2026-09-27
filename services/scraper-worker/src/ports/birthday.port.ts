import type { BirthdayAudience } from '@juriflow/shared-types';

/** Aniversariante do dia, já filtrado pelas regras de N14. */
export interface BirthdayPerson {
  readonly spaceId: string;
  readonly spaceName: string;
  readonly type: BirthdayAudience;
  /** Perfil (equipe) ou cliente. */
  readonly recipientId: string;
  readonly fullName: string;
  readonly phone: string;
  /** Já recebeu hoje (ou já falhou vezes demais). */
  readonly done: boolean;
}

export interface BirthdayGreetingRecord {
  readonly spaceId: string;
  readonly type: BirthdayAudience;
  readonly recipientId: string;
  /** AAAA-MM-DD no fuso do escritório. */
  readonly day: string;
  readonly phone: string;
}

/** Leitura dos aniversariantes/templates e registro dos parabéns enviados. */
export interface BirthdayRepository {
  listOn(day: string): Promise<readonly BirthdayPerson[]>;
  /** Corpo do template escolhido pelo ADMIN por público; null = padrão do sistema. */
  templatesFor(spaceId: string): Promise<Record<BirthdayAudience, string | null>>;
  recordSent(record: BirthdayGreetingRecord): Promise<void>;
  recordFailed(record: BirthdayGreetingRecord, error: string): Promise<void>;
}
