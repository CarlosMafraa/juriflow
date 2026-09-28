import type { IsoDateTime, Uuid } from './entities.js';

/**
 * Motor de notificações configurável (RN seções 10/11/40). Sem regra por tipo
 * de movimentação: o scraping devolve texto livre, sem taxonomia de evento —
 * a configuração é só por destinatário (responsável/cliente), que é o que a
 * regra de negócio pede sem inventar uma classificação que não existe.
 */

export const NOTIFICATION_AUDIENCES = ['responsible', 'client'] as const;
/** `team` só existe em template de aniversário (equipe do escritório). */
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number] | 'team';

/**
 * Template de mensagem WhatsApp. Movimentação: {{numero_processo}},
 * {{movimentacao}}, {{data}}. Aniversário: {{nome}}, {{escritorio}}.
 */
export interface MessageTemplate {
  id: Uuid;
  spaceId: Uuid;
  name: string;
  kind: TemplateKind;
  audience: NotificationAudience;
  body: string;
  createdBy: Uuid;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime | null;
}

/** Configuração geral do espaço — padrão para processos sem config própria. */
export interface SpaceNotificationConfig {
  spaceId: Uuid;
  notifyResponsible: boolean;
  notifyClients: boolean;
  responsibleTemplateId: Uuid | null;
  clientTemplateId: Uuid | null;
  /** Aniversário (N14): null = padrão do sistema. */
  teamBirthdayTemplateId: Uuid | null;
  clientBirthdayTemplateId: Uuid | null;
  updatedBy: Uuid | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime | null;
}

/** Override por processo. Campo `null` = herda da config do espaço. */
export interface ProcessNotificationConfig {
  processId: Uuid;
  spaceId: Uuid;
  notifyResponsible: boolean | null;
  notifyClients: boolean | null;
  responsibleTemplateId: Uuid | null;
  clientTemplateId: Uuid | null;
  updatedBy: Uuid | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime | null;
}

/**
 * Mensagem padrão do sistema: vale quando nem o processo nem o escritório
 * escolheram um template. É a MESMA que o worker envia (scraper-worker
 * `GeneralMovementTemplate`), por isso fica aqui — a tela mostra exatamente o
 * que o cliente/responsável recebe. Placeholders como nos templates;
 * `{{quantidade}}` só na versão com várias movimentações numa mensagem.
 */
export const DEFAULT_MESSAGE_TEMPLATE = {
  name: 'Padrão do sistema',
  body: 'Olá! Houve uma nova movimentação no processo {{numero_processo}}.\n\nData: {{data}}\nMovimentação: {{movimentacao}}',
  digestBody:
    'Olá! O processo {{numero_processo}} teve {{quantidade}} movimentações:\n\n{{movimentacao}}',
} as const;

/** Tipo do template: aviso de movimentação ou mensagem de aniversário. */
export const TEMPLATE_KINDS = ['movement', 'birthday'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

/** Público do template de aniversário: a equipe do escritório ou os clientes. */
export const BIRTHDAY_AUDIENCES = ['team', 'client'] as const;
export type BirthdayAudience = (typeof BIRTHDAY_AUDIENCES)[number];

/**
 * Mensagens de aniversário padrão do sistema (N14): valem quando o ADMIN não
 * escolheu um template. Placeholders: {{nome}} (primeiro nome) e
 * {{escritorio}} (nome do espaço). As mesmas que o worker envia.
 */
export const DEFAULT_BIRTHDAY_TEMPLATES: Record<BirthdayAudience, { name: string; body: string }> =
  {
    team: {
      name: 'Padrão do sistema',
      body: 'Feliz aniversário, {{nome}}! 🎉\n\nToda a equipe do {{escritorio}} deseja um dia incrível e um novo ano cheio de conquistas.',
    },
    client: {
      name: 'Padrão do sistema',
      body: 'Olá, {{nome}}! 🎂\n\nO {{escritorio}} deseja a você um feliz aniversário, com muita saúde e realizações. Conte sempre conosco!',
    },
  };
