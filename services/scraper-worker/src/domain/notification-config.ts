/** Config bruta como vem do banco — mesma forma pra `space_notification_configs` e `process_notification_configs`. */
export interface RawNotificationConfig {
  readonly notifyResponsible: boolean | null;
  readonly notifyClients: boolean | null;
  readonly responsibleTemplateId: string | null;
  readonly clientTemplateId: string | null;
}

/** Resultado já resolvido — nunca tem `null` em notify*, sempre uma decisão. */
export interface EffectiveNotificationConfig {
  readonly notifyResponsible: boolean;
  readonly notifyClients: boolean;
  readonly responsibleTemplateId: string | null;
  readonly clientTemplateId: string | null;
}

const HARDCODED_DEFAULT: EffectiveNotificationConfig = {
  notifyResponsible: true,
  notifyClients: true,
  responsibleTemplateId: null,
  clientTemplateId: null,
};

/**
 * Resolve a config efetiva de um processo (RN seção 40): a config do processo
 * prevalece campo a campo; campos ausentes/nulos caem pra config do espaço;
 * na ausência de ambos, o padrão é notificar os dois com o template genérico
 * embutido (comportamento do MVP antes deste motor existir — não regride).
 * Função pura — sem I/O — pra ser testável sem mock de Supabase.
 */
export function resolveEffectiveConfig(
  space: RawNotificationConfig | null,
  process: RawNotificationConfig | null,
): EffectiveNotificationConfig {
  return {
    notifyResponsible:
      process?.notifyResponsible ?? space?.notifyResponsible ?? HARDCODED_DEFAULT.notifyResponsible,
    notifyClients:
      process?.notifyClients ?? space?.notifyClients ?? HARDCODED_DEFAULT.notifyClients,
    responsibleTemplateId:
      process?.responsibleTemplateId ??
      space?.responsibleTemplateId ??
      HARDCODED_DEFAULT.responsibleTemplateId,
    clientTemplateId:
      process?.clientTemplateId ?? space?.clientTemplateId ?? HARDCODED_DEFAULT.clientTemplateId,
  };
}
