// =============================================================================
// send-invite — manda o e-mail de convite do Supabase Auth para quem ainda não
// tem conta no JuriFlow (o app não tem cadastro público: signup desligado).
//
// Dois modos, ambos exigem JWT de usuário (verify_jwt):
//   { inviteId } — convite de ESPAÇO já criado pela RPC create_space_invite.
//                  A autorização é a própria RLS: só ADMIN do espaço (ou
//                  SUPER_ADMIN) enxerga a linha em space_invites.
//   { email }    — convite de PLATAFORMA, só SUPER_ADMIN: cria a conta do
//                  futuro ADMIN de um escritório novo (depois ele é escolhido
//                  como ADMIN ao criar o espaço em /admin).
//
// Quem já tem conta não recebe e-mail: vê o convite ao entrar (my_pending_invites).
// A service_role key só existe aqui, no runtime das Edge Functions.
// =============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Status = 'invited' | 'existing_user';

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

  // Cliente com o JWT de quem chamou: tudo que ele lê passa pela RLS.
  const asCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
  } = await asCaller.auth.getUser();
  if (!user) return json(401, { error: 'Sessão inválida.' });

  const body = (await req.json().catch(() => null)) as { inviteId?: string; email?: string } | null;

  let email: string;
  if (body?.inviteId) {
    const { data: invite } = await asCaller
      .from('space_invites')
      .select('email, status, expires_at')
      .eq('id', body.inviteId)
      .maybeSingle();
    if (!invite || invite.status !== 'pending' || new Date(invite.expires_at) <= new Date()) {
      return json(404, { error: 'Convite não encontrado ou não está mais pendente.' });
    }
    email = String(invite.email).toLowerCase();
  } else if (body?.email) {
    const { data: me } = await asCaller
      .from('profiles')
      .select('is_super_admin')
      .eq('id', user.id)
      .maybeSingle();
    if (!me?.is_super_admin) {
      return json(403, { error: 'Apenas SUPER_ADMIN convida usuários para a plataforma.' });
    }
    email = body.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return json(400, { error: 'E-mail inválido.' });
  } else {
    return json(400, { error: 'Informe inviteId ou email.' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existing, error: lookupError } = await admin
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (lookupError) return json(500, { error: 'Falha ao verificar o e-mail.' });
  if (existing) {
    // Conta criada por um convite anterior que nunca foi aceito (e-mail perdido,
    // link expirado): reenvia. O Auth só recusa reenviar para conta confirmada.
    const { data: authUser } = await admin.auth.admin.getUserById(existing.id);
    if (authUser.user?.email_confirmed_at) {
      return json(200, { status: 'existing_user' satisfies Status });
    }
  }

  // APP_SITE_URL é obrigatório em produção (secret da função). O Origin só
  // serve de fallback local; de qualquer forma o Auth só aceita redirects que
  // estejam na allow-list do projeto.
  const siteUrl = (Deno.env.get('APP_SITE_URL') ?? req.headers.get('origin') ?? '').replace(
    /\/$/,
    '',
  );
  if (!siteUrl) return json(500, { error: 'APP_SITE_URL não configurado.' });

  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteUrl}/redefinir-senha?convite=1`,
  });
  if (inviteError) {
    console.error('inviteUserByEmail falhou', inviteError.message);
    return json(502, { error: 'Não foi possível enviar o e-mail de convite.' });
  }

  return json(200, { status: 'invited' satisfies Status });
});
