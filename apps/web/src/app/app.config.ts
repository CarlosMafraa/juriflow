import { APP_INITIALIZER, ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';
import { ConfirmationService, MessageService } from 'primeng/api';
import Aura from '@primeng/themes/aura';
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
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: Aura,
        options: {
          // Sem dark mode nesta fase — nenhuma tela do produto tem toggle ainda.
          darkModeSelector: false,
        },
      },
    }),
    MessageService,
    ConfirmationService,
    // Hidrata a sessão antes do primeiro render para os guards decidirem certo.
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [AuthService],
      useFactory: (auth: AuthService) => () => auth.initialize(),
    },
  ],
};
