# Deploy — checklist de produção (v1)

Topologia: **frontend** (SPA Angular estática) numa hospedagem de arquivos
estáticos, **worker + WAHA** numa VPS com Docker Compose (`infra/vps`) e
**Supabase Cloud** como banco/Auth/Storage/Edge Functions.

Itens marcados com ⚙️ são feitos no painel do Supabase — não há como
versionar pelo repositório.

## 1. Supabase Cloud

### Projeto e banco

- [ ] Plano **Pro** (o Free pausa o projeto após 7 dias sem uso e não tem
      backup diário). Conferir em Database → Backups que os backups diários
      estão ativos; PITR é opcional.
- [ ] Região mais próxima dos usuários (ex.: `sa-east-1`, São Paulo).
- [ ] Aplicar as migrations:
      `bash
  npx supabase link --project-ref <ref>
  npx supabase db push
  `
- [ ] Rodar o seed só se quiser o catálogo de tribunais inicial
      (`supabase/seed.sql`) — ele não cria usuários.

### Auth ⚙️

Espelha o `supabase/config.toml` (que só vale para o ambiente local):

- [ ] Authentication → Sign In / Providers → **Email habilitado**.
      ⚠️ Não desligue o provedor de e-mail: isso bloqueia também o login.
- [ ] Mesma tela → **"Allow new users to sign up" desligado** — contas nascem
      só por convite (Edge Function `send-invite`).
- [ ] **"Confirm email" ligado** — o aceite de convite confia no e-mail
      confirmado (migração 0030).
- [ ] Policies de senha: mínimo **8** caracteres, requisito **letras e
      dígitos**; ligar **proteção contra senhas vazadas** (HaveIBeenPwned).
- [ ] URL Configuration → **Site URL** = domínio do app
      (ex.: `https://app.juriflow.com.br`) e **Redirect URLs** =
      `https://app.juriflow.com.br/**`.
- [ ] Emails → Templates: colar `supabase/templates/invite.html`
      (assunto "Você foi convidado para o JuriFlow") e
      `supabase/templates/recovery.html` (assunto "Redefinição de senha — JuriFlow").
- [ ] **SMTP próprio** (Resend, Amazon SES, Brevo...) em Authentication →
      Emails → SMTP Settings. O SMTP padrão do Supabase só entrega para
      membros da equipe do projeto e tem limite de poucos e-mails por hora —
      convites e recuperação de senha **não chegam** aos clientes sem isso.
      Configurar SPF/DKIM do domínio remetente.

### Edge Function `send-invite`

```bash
npx supabase functions deploy send-invite
npx supabase secrets set APP_SITE_URL=https://app.juriflow.com.br
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` já são
injetadas pelo runtime — não configurar manualmente.

### Primeiro SUPER_ADMIN ⚙️

Com o cadastro público desligado, crie o primeiro usuário em Authentication →
Users → **Invite user** e, no SQL Editor:

```sql
update public.profiles set is_super_admin = true where email = 'voce@dominio.com';
```

A partir daí, escritórios novos são criados pelo app: `/admin` → **Convidar
usuário** (futuro ADMIN) → **Criar espaço** escolhendo essa pessoa.

## 2. Frontend (SPA)

Build (na raiz do monorepo):

```bash
npm ci
WEB_SUPABASE_URL=https://<ref>.supabase.co \
WEB_SUPABASE_ANON_KEY=<anon-ou-publishable-key> \
REQUIRE_WEB_ENV=true \
npm run build
```

- Saída: `apps/web/dist/web/browser`.
- `scripts/inject-env.mjs` roda no `postbuild`: troca os placeholders do
  bundle e **falha** se faltar variável (com `REQUIRE_WEB_ENV=true`), se a
  URL não for `https` ou se a chave for `service_role`/secret.
- A hospedagem precisa de **fallback de SPA** (toda rota desconhecida serve
  `index.html`), senão recarregar `/processos/<id>` dá 404.
- Cabeçalhos recomendados: `Strict-Transport-Security`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Frame-Options: DENY` e uma CSP com `connect-src` liberando
  `https://<ref>.supabase.co` e `wss://<ref>.supabase.co`.
- Cache: `index.html` sem cache (`no-cache`); arquivos com hash
  (`*.js`, `*.css`, fontes) com cache longo (`immutable`). Trocar as variáveis
  de ambiente exige novo build + deploy.

## 3. VPS — worker + WAHA

Passo a passo em [`infra/vps/README.md`](../infra/vps/README.md). Pontos de
produção:

- [ ] `infra/vps/.env` com a `service_role` key do projeto Cloud e uma
      `WAHA_API_KEY` forte (`openssl rand -hex 32`).
- [ ] `WAHA_IMAGE_TAG` fixa (≥ `2026.6.1`: sessões ilimitadas no WAHA Core,
      necessárias para uma sessão por espaço).
- [ ] `DAILY_CHECK_TIMEZONE=America/Manaus` (o container roda em UTC).
- [ ] Nenhuma porta publicada (`docker compose ps` não deve mostrar `0.0.0.0:`).
      O app fala com o worker só pelo banco (filas em `whatsapp_sessions` e
      `processes.check_requested_at`).
- [ ] Mínimo 2 GB de RAM (Chromium do Playwright).
- [ ] Firewall liberando só SSH; atualizações automáticas de segurança do SO.

## 4. Depois do deploy — smoke test

1. Login do SUPER_ADMIN → `/admin` → convidar um e-mail real → o e-mail chega
   e o link abre "Bem-vindo ao JuriFlow".
2. Criar o espaço com essa pessoa como ADMIN; ela entra e vê o dashboard.
3. `/configuracoes/whatsapp` → Conectar → QR aparece (worker + WAHA ok).
4. Cadastrar um processo do TJAM com CNJ → "Consultar agora" → em até
   ~1 min a consulta conclui (ou mostra a falha da fonte).
5. "Esqueci minha senha" → e-mail em português chega.
