// =============================================================================
// Pós-build: troca os placeholders de `environment.production.ts`
// (`__WEB_SUPABASE_URL__`, `__WEB_SUPABASE_ANON_KEY__`) pelos valores das
// variáveis de ambiente do pipeline de deploy, direto no bundle gerado.
//
// Funciona em qualquer hospedagem (Vercel, container nginx, S3...): basta
// definir WEB_SUPABASE_URL e WEB_SUPABASE_ANON_KEY no ambiente do build.
//   - Variáveis ausentes: avisa e deixa os placeholders (o app mostra uma tela
//     de "configuração ausente" em vez de quebrar). Com REQUIRE_WEB_ENV=true
//     (use no deploy), falha o build.
//   - Chave com cara de service_role / secret: falha SEMPRE — essa chave
//     ignora a RLS e nunca pode ir para o navegador.
// =============================================================================
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'dist', 'web', 'browser');

const PLACEHOLDERS = {
  __WEB_SUPABASE_URL__: process.env.WEB_SUPABASE_URL?.trim(),
  __WEB_SUPABASE_ANON_KEY__: process.env.WEB_SUPABASE_ANON_KEY?.trim(),
};
const required = process.env.REQUIRE_WEB_ENV === 'true';

function fail(message) {
  console.error(`\n[inject-env] ERRO: ${message}\n`);
  process.exit(1);
}

/** Papel embutido numa chave JWT legada do Supabase (anon / service_role). */
function jwtRole(key) {
  const payload = key.split('.')[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role ?? null;
  } catch {
    return null;
  }
}

const url = PLACEHOLDERS.__WEB_SUPABASE_URL__;
const key = PLACEHOLDERS.__WEB_SUPABASE_ANON_KEY__;

if (key && (key.startsWith('sb_secret_') || jwtRole(key) === 'service_role')) {
  fail('WEB_SUPABASE_ANON_KEY é uma chave secreta (service_role). Use a anon/publishable key.');
}
if (url && !/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(url)) {
  fail(`WEB_SUPABASE_URL deve usar https:// (recebido: ${url}).`);
}

const missing = Object.entries(PLACEHOLDERS)
  .filter(([, value]) => !value)
  .map(([placeholder]) => placeholder.slice(2, -2));

if (missing.length) {
  const message = `variáveis ausentes: ${missing.join(', ')} — o bundle mantém os placeholders.`;
  if (required) fail(message);
  console.warn(`[inject-env] aviso: ${message}`);
  process.exit(0);
}

let replacedFiles = 0;
for (const file of readdirSync(outDir).filter((f) => f.endsWith('.js'))) {
  const path = join(outDir, file);
  const original = readFileSync(path, 'utf8');
  let content = original;
  for (const [placeholder, value] of Object.entries(PLACEHOLDERS)) {
    content = content.replaceAll(placeholder, value);
  }
  if (content !== original) {
    writeFileSync(path, content);
    replacedFiles++;
  }
}

if (replacedFiles === 0) {
  fail('nenhum placeholder encontrado no bundle — rode sobre um build de produção recém-gerado.');
}
console.log(`[inject-env] configuração pública injetada em ${replacedFiles} arquivo(s).`);
