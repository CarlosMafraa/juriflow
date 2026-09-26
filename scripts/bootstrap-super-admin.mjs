// =============================================================================
// Cria o ÚNICO SUPER_ADMIN da plataforma — sem alterar o banco "na mão".
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role> \
//   APP_SITE_URL=https://app.juriflow.com.br \
//   npm run bootstrap:super-admin -- voce@dominio.com
//
// 1. Recusa se já existe um SUPER_ADMIN (a plataforma tem um só).
// 2. Convida o e-mail (se ainda não tem conta): o link leva ao primeiro
//    acesso, onde a pessoa cria a senha e completa os dados. Vale 24 h.
// 3. Promove pela função bootstrap_super_admin, que registra na auditoria
//    (platform.super_admin.grant, via = bootstrap).
// Rode uma vez por ambiente, a partir do repositório (versionado e revisável).
// =============================================================================
import { createClient } from '@supabase/supabase-js';

function fail(message) {
  console.error(`\n[bootstrap-super-admin] ${message}\n`);
  process.exit(1);
}

const email = (process.argv[2] ?? '').trim().toLowerCase();
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const siteUrl = (process.env.APP_SITE_URL ?? '').replace(/\/$/, '');

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  fail('Informe o e-mail: npm run bootstrap:super-admin -- voce@dominio.com');
if (!url || !serviceKey) fail('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
if (!siteUrl) fail('Defina APP_SITE_URL (endereço do app, para o link do convite).');

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { count, error: countError } = await admin
  .from('profiles')
  .select('id', { count: 'exact', head: true })
  .eq('is_super_admin', true);
if (countError) fail(`Não foi possível consultar o banco: ${countError.message}`);
if (count)
  fail('Já existe um SUPER_ADMIN. A plataforma tem um único administrador — nada foi alterado.');

const { data: existing } = await admin
  .from('profiles')
  .select('id')
  .eq('email', email)
  .maybeSingle();
if (!existing) {
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteUrl}/primeiro-acesso`,
  });
  if (error) fail(`Não foi possível enviar o convite: ${error.message}`);
  console.log(`[bootstrap-super-admin] Convite enviado para ${email} (o link vale 24 horas).`);
}

const { error: grantError } = await admin.rpc('bootstrap_super_admin', { p_email: email });
if (grantError) fail(`Não foi possível promover: ${grantError.message}`);

console.log(
  `[bootstrap-super-admin] ${email} é o SUPER_ADMIN da plataforma (registrado na auditoria).`,
);
if (!existing) console.log('[bootstrap-super-admin] Abra o link do e-mail para criar a senha.');
