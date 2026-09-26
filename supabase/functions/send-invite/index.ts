// =============================================================================
// send-invite — manda o e-mail do link de um convite (space_invites).
//
// Serve aos dois convites do produto:
//   - SUPER_ADMIN -> ADMIN de um escritório novo (create_space_for_admin);
//   - ADMIN -> colaborador/ADMIN do próprio espaço (create_space_invite).
// Quem pode enviar e se o convite ainda vale quem decide é o banco
// (invite_delivery_info, com o JWT de quem chamou).
//
// O link leva a /primeiro-acesso?convite=<id>: lá o convite é marcado como
// aberto, a pessoa completa os dados e aceita. Regras do link:
//   - vale 24 h (otp_expiry do Auth + expires_at do convite);
//   - reenviar gera outro convite e outro token: o link anterior deixa de valer
//     (o Auth troca o token; o banco marca o convite antigo como substituído).
// =============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });

  const authorization = req.headers.get('Authorization');
  if (!authorization) return json(401, { error: 'Não autenticado.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const noSession = { persistSession: false, autoRefreshToken: false };

  const asCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: noSession,
  });
  const {
    data: { user },
  } = await asCaller.auth.getUser();
  if (!user) return json(401, { error: 'Sessão inválida.' });

  const body = (await req.json().catch(() => null)) as { inviteId?: string } | null;
  if (!body?.inviteId) return json(400, { error: 'Informe o convite.' });

  const { data: info, error: infoError } = await asCaller
    .rpc('invite_delivery_info', { p_invite_id: body.inviteId })
    .single<{
      email: string;
      role: string;
      account: 'none' | 'unconfirmed' | 'confirmed';
      has_password: boolean;
    }>();
  if (infoError || !info) {
    const status = infoError?.code === '42501' ? 403 : 409;
    return json(status, { error: infoError?.message ?? 'Convite inválido.' });
  }

  // APP_SITE_URL é obrigatório em produção (secret da função). O Origin só
  // serve de fallback local; o Auth só aceita redirects da allow-list.
  const siteUrl = (Deno.env.get('APP_SITE_URL') ?? req.headers.get('origin') ?? '').replace(
    /\/$/,
    '',
  );
  if (!siteUrl) return json(500, { error: 'APP_SITE_URL não configurado.' });

  const newAccount = info.account !== 'confirmed';
  // Sem senha ainda (conta nova, ou abriu um link anterior e não terminou): a tela pede para criar.
  const needsPassword = !info.has_password;
  const redirectTo = `${siteUrl}/primeiro-acesso?convite=${body.inviteId}${needsPassword ? '&nova=1' : ''}`;

  let sendError: { message: string } | null = null;
  if (newAccount) {
    // Conta nova (ou convite anterior nunca aceito): e-mail de convite do Auth.
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: noSession });
    ({ error: sendError } = await admin.auth.admin.inviteUserByEmail(info.email, { redirectTo }));
  } else {
    // Já tem conta: link de acesso (magic link) com o mesmo destino.
    const anon = createClient(supabaseUrl, anonKey, { auth: noSession });
    ({ error: sendError } = await anon.auth.signInWithOtp({
      email: info.email,
      options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
    }));
  }
  if (sendError) {
    console.error('envio do convite falhou', sendError.message);
    return json(502, { error: 'Não foi possível enviar o e-mail de convite.' });
  }

  return json(200, { status: 'sent' });
});
