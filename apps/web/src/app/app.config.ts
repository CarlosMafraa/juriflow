import { APP_INITIALIZER, ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { provideAppConfig } from './core/config/app-config';
import { provideSupabase } from './core/supabase/supabase-client';
import { AuthService } from './core/auth/auth.service';
import { requestIdInterceptor } from './core/http/request-id.interceptor';
import { errorInterceptor } from './core/http/error.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([requestIdInterceptor, errorInterceptor])),
    provideAppConfig(),
    provideSupabase(),
    // Hidrata a sessão antes do primeiro render para os guards decidirem certo.
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [AuthService],
      useFactory: (auth: AuthService) => () => auth.initialize(),
    },
  ],
};
