import type { EffectiveNotificationConfig } from '../domain/notification-config.js';

/** Resolve a config efetiva (espaço + override do processo já mesclados). */
export interface NotificationConfigResolver {
  resolve(processId: string, spaceId: string): Promise<EffectiveNotificationConfig>;
}
