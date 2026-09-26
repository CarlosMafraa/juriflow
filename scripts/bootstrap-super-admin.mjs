// =============================================================================
// Cria o ÚNICO SUPER_ADMIN da plataforma — sem alterar o banco "na mão".
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role> \
//   APP_SITE_URL=https://app.juriflow.com.br \
//   npm run bootstrap:super-admin -- voce@dominio.com
//
// 1. Recusa se já existe um SUPER_ADMIN (a plataforma tem um só) — exceto
//    para reenviar o link: mesmo e-mail e primeiro acesso ainda não concluído.
// 2. Envia o link do primeiro acesso, onde a pessoa cria a senha e completa
//    os dados. Vale 24 h; um link novo invalida o anterior.
// 3. Promove pela função bootstrap_super_admin, que registra na auditoria
//    (platform.super_admin.grant ou .invite_resent, via = bootstrap).
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

const { data: current, error: currentError } = await admin
  .from('profiles')
  .select('id, email, onboarded_at')
  .eq('is_super_admin', true)
  .maybeSingle();
if (currentError) fail(`Não foi possível consultar o banco: ${currentError.message}`);
const resend = Boolean(current);
if (current && (current.email.toLowerCase() !== email || current.onboarded_at))
  fail('Já existe um SUPER_ADMIN. A plataforma tem um único administrador — nada foi alterado.');

const { data: existing } = await admin
  .from('profiles')
  .select('id, onboarded_at')
  .eq('email', email)
  .maybeSingle();

let linkSent = false;
if (!existing?.onboarded_at) {
  const redirectTo = `${siteUrl}/primeiro-acesso`;
  const { data: account } = existing
    ? await admin.auth.admin.getUserById(existing.id)
    : { data: null };
  // Conta que já confirmou o e-mail não aceita convite: recebe link de acesso.
  const { error } = account?.user?.email_confirmed_at
    ? await admin.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
      })
    : await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (error) fail(`Não foi possível enviar o link: ${error.message}`);
  linkSent = true;
  console.log(
    `[bootstrap-super-admin] ${resend ? 'Novo link enviado' : 'Convite enviado'} para ${email} ` +
      '(vale 24 horas; links anteriores deixam de valer).',
  );
}

const { error: grantError } = await admin.rpc('bootstrap_super_admin', { p_email: email });
if (grantError) fail(`Não foi possível promover: ${grantError.message}`);

console.log(
  `[bootstrap-super-admin] ${email} é o SUPER_ADMIN da plataforma (registrado na auditoria).`,
);
if (linkSent) console.log('[bootstrap-super-admin] Abra o link do e-mail para criar a senha.');
