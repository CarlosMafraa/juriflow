import { InjectionToken, inject, type Provider } from '@angular/core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { APP_CONFIG } from '../config/app-config';

export const SUPABASE_CLIENT = new InjectionToken<SupabaseClient>('SUPABASE_CLIENT');

export function provideSupabase(): Provider {
  return {
    provide: SUPABASE_CLIENT,
    useFactory: (): SupabaseClient => {
      const config = inject(APP_CONFIG);
      return createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: 'juriflow.auth',
        },
      });
    },
  };
}
