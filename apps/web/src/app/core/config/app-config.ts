import { InjectionToken, type Provider } from '@angular/core';
import { environment } from '../../../environments/environment';

export interface AppConfig {
  readonly production: boolean;
  readonly appName: string;
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly requestIdHeader: string;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG');

export function provideAppConfig(overrides: Partial<AppConfig> = {}): Provider {
  return {
    provide: APP_CONFIG,
    useValue: { ...environment, ...overrides } satisfies AppConfig,
  };
}
