import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { environment } from './environments/environment';

// Build publicado sem WEB_SUPABASE_URL/WEB_SUPABASE_ANON_KEY (scripts/inject-env.mjs):
// em vez de uma tela branca com erro de rede no console, diz o que falta.
const missingConfig = [environment.supabaseUrl, environment.supabaseAnonKey].some((v) =>
  v.startsWith('__'),
);

if (missingConfig) {
  document.body.innerHTML =
    '<main style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#0f172a">' +
    '<h1 style="font-size:1.25rem">JuriFlow indisponível</h1>' +
    '<p>Esta publicação está sem a configuração do servidor. ' +
    'Defina <code>WEB_SUPABASE_URL</code> e <code>WEB_SUPABASE_ANON_KEY</code> no ambiente de build e publique novamente.</p>' +
    '</main>';
} else {
  bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
}
