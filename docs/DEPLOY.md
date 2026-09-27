# Deploy do JuriFlow — v1 (custo zero para começar)

Guia completo para colocar o JuriFlow no ar. O inventário do que cada peça
precisa (máquina, versões, rede, segredos) está em [REQUISITOS.md](REQUISITOS.md). Siga as seções **na ordem**:
cada uma usa valores gerados na anterior.

Itens marcados com ⚙️ são feitos em painéis (Supabase, Resend, Cloudflare,
Healthchecks) — não há como versionar pelo repositório.

## Visão geral

| Peça                       | Onde                                                            | Plano                                        | Custo                |
| -------------------------- | --------------------------------------------------------------- | -------------------------------------------- | -------------------- |
| Frontend (SPA Angular)     | **Cloudflare Workers** (estático)                               | Free (uso comercial permitido)               | R$ 0                 |
| Banco, Auth, Edge Function | **Supabase**                                                    | Free → **Pro** quando houver cliente pagando | R$ 0 → US$ 25/mês    |
| E-mails (convite, senha)   | **Resend** (SMTP)                                               | Free: 3.000/mês, 100/dia                     | R$ 0                 |
| Worker de coleta + WAHA    | **Computador sempre ligado em casa** (ou VPS barata) com Docker | —                                            | R$ 0 (ou ~US$ 5/mês) |
| Alerta de worker parado    | **Healthchecks.io**                                             | Free: 20 monitores (e-mail/Telegram)         | R$ 0                 |

Por que assim (pesquisa de 26/09/2026):

- **Vercel Hobby proíbe uso comercial** — por isso Cloudflare (Workers com
  arquivos estáticos, gratuito e sem cobrança por requisição).
- **Worker em casa**: o firewall do TJAM aceitou o IP residencial no teste
  real e bloqueia com facilidade (regra F4); IP de datacenter tende a ser
  tratado pior. A Oracle "Always Free" caiu para 2 CPU/12 GB em 06/2026 e
  **apaga VM gratuita ociosa** (CPU, rede e memória < 20% por 7 dias) — o
  worker passa a maior parte do dia parado.
- **Supabase Free pausa o projeto após 7 dias sem uso e não tem backup.** O
  batimento do worker (1 por minuto) conta como uso, mas antes de ter cliente
  pagando, migre para o Pro (backup diário).

## Mapa de variáveis de ambiente

Cada variável vive em **um** lugar. Segredos (🔒) nunca vão para o
repositório, para o frontend nem para mensagens/prints.

### Cloudflare (build do frontend) — públicas por natureza

| Variável                           | Valor                                    | Observação                                                                                  |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `WEB_SUPABASE_URL`                 | `https://<ref>.supabase.co`              | Obrigatória. `https://` sempre.                                                             |
| `WEB_SUPABASE_ANON_KEY`            | chave **anon / publishable** do Supabase | Obrigatória. Pública: quem protege os dados é a RLS. O build **recusa** chave service_role. |
| `REQUIRE_WEB_ENV`                  | `true`                                   | Faz o build falhar se faltar alguma das duas acima.                                         |
| `NODE_VERSION`                     | `22`                                     | Versão do Node no build (também em `.node-version`).                                        |
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` | `1`                                      | O build não precisa de navegador.                                                           |

### Supabase → Edge Functions → Secrets

| Variável       | Valor                                               | Observação                                   |
| -------------- | --------------------------------------------------- | -------------------------------------------- |
| `APP_SITE_URL` | endereço do app (ex.: `https://juriflow.pages.dev`) | Base dos links de convite. Sem barra no fim. |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são
injetadas pela própria Supabase — **não** cadastrar.

### Servidor do worker — arquivo `infra/vps/.env` (nunca versionado)

| Variável                    | Obrigatória | Valor recomendado            | Observação                                                                              |
| --------------------------- | ----------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| `SUPABASE_URL`              | sim         | `https://<ref>.supabase.co`  |                                                                                         |
| `SUPABASE_SERVICE_ROLE_KEY` | sim 🔒      | chave **service_role**       | Ignora a RLS: só neste arquivo. Nunca no frontend.                                      |
| `WAHA_API_KEY`              | sim 🔒      | `openssl rand -hex 32`       | O mesmo valor protege o WAHA e é usado pelo worker.                                     |
| `WAHA_BASE_URL`             | sim         | `http://waha:3000`           | Rede interna do compose — não mudar.                                                    |
| `HEALTHCHECK_PING_URL`      | recomendada | `https://hc-ping.com/<uuid>` | Sem ela, ninguém é avisado se o worker cair (seção 6).                                  |
| `SCRAPER_HEADLESS`          | não         | `false`                      | O TJAM rejeita headless; o container roda com tela virtual (Xvfb).                      |
| `SCRAPER_THROTTLE_MS`       | não         | `60000`                      | Pausa entre processos na rotina diária. Comece alto por causa do firewall do TJAM (F4). |
| `WHATSAPP_MIN_INTERVAL_MS`  | não         | `30000`                      | Pausa mínima entre mensagens (anti-bloqueio, N9).                                       |
| `WHATSAPP_MAX_INTERVAL_MS`  | não         | `60000`                      | Pausa máxima entre mensagens.                                                           |
| `DAILY_CHECK_CRON`          | não         | `0 8 * * *`                  | Horário da rotina diária.                                                               |
| `DAILY_CHECK_TIMEZONE`      | não         | `America/Manaus`             | Fuso do horário acima (o container roda em UTC).                                        |
| `CHECK_REQUEST_POLL_MS`     | não         | `10000`                      | De quanto em quanto tempo atende o "Consultar agora".                                   |
| `WAHA_SESSION_POLL_MS`      | não         | `5000`                       | De quanto em quanto tempo atende "Conectar WhatsApp".                                   |
| `HTTP_PORT`                 | não         | `3000`                       | Porta interna do worker (não publicada).                                                |
| `LOG_LEVEL`                 | não         | `info`                       |                                                                                         |

O modelo pronto está em [`infra/vps/.env.example`](../infra/vps/.env.example).

### Só no seu terminal, uma vez (criar o SUPER_ADMIN)

| Variável                    | Valor                       |
| --------------------------- | --------------------------- |
| `SUPABASE_URL`              | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | 🔒 chave service_role       |
| `APP_SITE_URL`              | endereço do app             |

O **e-mail do SUPER_ADMIN não é variável**: é digitado no comando (seção 5).

### Painéis (não são variáveis, mas são configuração)

| Onde                         | O quê                                         |
| ---------------------------- | --------------------------------------------- |
| Supabase → Auth → URL Config | Site URL e Redirect URLs = endereço do app    |
| Supabase → Auth → SMTP       | Host, porta, usuário e senha 🔒 do Resend     |
| Resend → Domains             | Registros DNS (SPF/DKIM) do domínio remetente |
| Healthchecks.io              | Check de 1 min + canal de aviso               |

---

## 1. Supabase ⚙️

### 1.1 Projeto

- [ ] Criar o projeto em [supabase.com](https://supabase.com), região
      **São Paulo (`sa-east-1`)**. Guarde a senha do banco num gerenciador
      de senhas.
- [ ] Em **Project Settings → API**, anote: `Project URL` (`https://<ref>.supabase.co`),
      a chave **anon/publishable** e a chave **service_role** 🔒.

### 1.2 Banco (migrations)

Do seu computador, na raiz do repositório:

```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push
```

- [ ] Todas as migrations aplicadas sem erro (`db push` lista 0001 a 0044).
- [ ] Rodar o seed (`supabase/seed.sql`) só para o catálogo inicial de
      tribunais — ele não cria usuários. Depois, no app, a plataforma deixa
      **só o TJAM ativo** (regra F3).

### 1.3 Autenticação

Espelha o `supabase/config.toml` (que só vale no ambiente local):

- [ ] **Authentication → Sign In / Providers → Email**: habilitado.
      ⚠️ Não desligue o provedor de e-mail — isso bloqueia também o login.
- [ ] Mesma tela: **"Allow new users to sign up" desligado** (contas nascem
      só por convite).
- [ ] **"Confirm email" ligado** (o aceite de convite confia no e-mail
      confirmado).
- [ ] Senha: mínimo **8** caracteres, **letras e dígitos**; ligar
      **proteção contra senhas vazadas**.
- [ ] **URL Configuration**: **Site URL** = endereço do app (seção 3) e
      **Redirect URLs** = `<endereço do app>/**`. Volte aqui depois da
      seção 3 se ainda não souber o endereço.
- [ ] **Emails → Templates** (copiar o HTML dos arquivos):
  - Invite user → `supabase/templates/invite.html`, assunto
    "Você foi convidado para o JuriFlow";
  - Magic Link → `supabase/templates/magic_link.html`, assunto
    "Você tem um convite no JuriFlow";
  - Reset Password → `supabase/templates/recovery.html`, assunto
    "Redefinição de senha — JuriFlow".
- [ ] **Email OTP Expiration = 86400** (24 h — o link de convite vale 24 h).

### 1.4 Edge Function de convite

```bash
npx supabase functions deploy send-invite
npx supabase secrets set APP_SITE_URL=https://<endereço-do-app>
```

## 2. E-mail (Resend) ⚙️

Sem SMTP próprio, o Supabase só entrega e-mail para a equipe do projeto e
poucos por hora: **convites e "esqueci minha senha" não chegam aos clientes**.

- [ ] Criar conta em [resend.com](https://resend.com).
- [ ] **Domains → Add Domain**: o domínio que vai remeter (ex.:
      `juriflow.com.br`). Criar no DNS do domínio os registros que o Resend
      mostrar (SPF, DKIM) e esperar ficar "Verified". Sem domínio próprio o
      Resend só envia para o seu próprio e-mail — dá para testar, não para
      clientes.
- [ ] **API Keys → Create** (permissão "Sending access") — é a senha SMTP 🔒.
- [ ] No Supabase, **Authentication → Emails → SMTP Settings**:

  | Campo        | Valor                               |
  | ------------ | ----------------------------------- |
  | Host         | `smtp.resend.com`                   |
  | Port         | `465`                               |
  | Username     | `resend`                            |
  | Password     | a API key do Resend 🔒              |
  | Sender email | ex.: `nao-responda@juriflow.com.br` |
  | Sender name  | `JuriFlow`                          |

- [ ] Limite do plano gratuito: **100 e-mails por dia**, 3.000 por mês.

## 3. Frontend (Cloudflare Workers — arquivos estáticos) ⚙️

A Cloudflare agora cria **Workers** (com arquivos estáticos) no lugar de
projetos Pages. Para o JuriFlow dá no mesmo: o Worker **só serve arquivos**
(sem código de servidor), então nenhuma requisição é cobrada. A configuração
está em [`wrangler.jsonc`](../wrangler.jsonc), na raiz do repositório.

**Faça antes a seção 1**: o build precisa da URL e da chave anon do Supabase
(sem elas, com `REQUIRE_WEB_ENV=true`, o build falha de propósito).

- [ ] [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages
      → Create → Import a repository** → `CarlosMafraa/juriflow`.
- [ ] Tela **"Set up your application"**:

  | Campo                          | Valor                            |
  | ------------------------------ | -------------------------------- |
  | Project name                   | `juriflow`                       |
  | Build command                  | `npm ci && npm run build`        |
  | Deploy command                 | `npx wrangler deploy` (o padrão) |
  | Enable Preview builds          | desligado                        |
  | Protect with Cloudflare Access | desligado                        |

- [ ] **Advanced settings** (ou depois em **Settings → Build**):

  | Campo                 | Valor                                                     |
  | --------------------- | --------------------------------------------------------- |
  | Git branch (produção) | `master` (o padrão da Cloudflare é `main`)                |
  | Root directory        | vazio (raiz do repositório)                               |
  | **Build variables**   | as cinco da tabela "Cloudflare (build do frontend)" acima |

  As variáveis do frontend são **Build variables** (usadas só durante o
  build): não use "Variables and Secrets" de runtime.

- [ ] Deploy. O endereço sai como `https://juriflow.<sua-conta>.workers.dev`.
      Domínio próprio (ex.: `app.juriflow.com.br`): **Settings → Domains &
      Routes → Add → Custom domain**.
- [ ] Voltar às seções 1.3 e 1.4 e colocar esse endereço em Site URL,
      Redirect URLs e `APP_SITE_URL`.

Já está no repositório:

- `wrangler.jsonc`: publica `apps/web/dist/web/browser` com
  `not_found_handling: "single-page-application"` — recarregar
  `/processos/<id>` devolve o app, não 404.
- `.node-version` (`22`): versão do Node no build.
- `apps/web/public/_headers`: cabeçalhos de segurança (HSTS, nosniff,
  proibido abrir em iframe) e `index.html` sem cache.
- O build **falha** se faltar variável, se a URL não for `https` ou se
  alguém colocar a chave service_role por engano.
- Trocar uma variável exige **novo deploy** (Deployments → Retry / novo push).
- Validar a configuração localmente, sem publicar:
  `npm run build && npx wrangler deploy --dry-run`.

## 4. Servidor do worker (em casa ou VPS)

O worker (coleta no TJAM + envio no WhatsApp) e o WAHA rodam juntos com
Docker Compose ([`infra/vps/`](../infra/vps/)). Não há porta pública: o app
fala com eles só pelo banco.

### 4.1 Máquina

- Linux (recomendado) ou Windows com Docker Desktop. Medido: ~1 GB de
  memória no pico (worker + WAHA) — **mínimo 2 GB livres, recomendado 4 GB**;
  disco **10 GB livres (recomendado 20 GB)**. Detalhes em
  [REQUISITOS.md](REQUISITOS.md#2-infraestrutura-do-servidor-do-worker-medida).
- **Sempre ligada**: desativar suspensão/hibernação; no Windows, Docker
  Desktop "iniciar com o Windows"; internet estável.
- Em casa: IP residencial (o que o TJAM aceitou no teste). Numa VPS: faça o
  teste da seção 7 antes de ter clientes — IP de datacenter pode ser
  bloqueado.

### 4.2 Subir

```bash
git clone https://github.com/CarlosMafraa/juriflow.git
cd juriflow/infra/vps
cp .env.example .env
# editar .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WAHA_API_KEY,
# HEALTHCHECK_PING_URL (seção 6) — ver o mapa de variáveis acima
docker compose up -d --build
docker compose ps        # waha e scraper-worker "running"; nenhuma porta 0.0.0.0
docker compose logs -f scraper-worker   # "Worker no ar." e "Batimento do worker agendado."
```

- [ ] Imagem do WAHA fixada por versão e digest no compose (nunca `latest`).
- [ ] O `.env` fica só nessa máquina (permissão restrita no Linux:
      `chmod 600 .env`).

### 4.3 Atualizar

```bash
cd juriflow && git pull && cd infra/vps && docker compose up -d --build
```

## 5. Primeiro SUPER_ADMIN

A plataforma tem **um único** SUPER_ADMIN, criado por comando versionado e
auditado — **nunca** por SQL manual (regra P2). No seu computador, na raiz do
repositório, com as três variáveis só nesta sessão do terminal:

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role> \
APP_SITE_URL=https://<endereço-do-app> \
npm run bootstrap:super-admin -- voce@dominio.com
```

- O e-mail chega (Resend) com o link de 24 h → criar a senha → painel da
  plataforma.
- Link expirou antes de criar a senha? Rode o **mesmo comando com o mesmo
  e-mail**: sai um link novo. Outro e-mail, ou depois do primeiro acesso: o
  comando é recusado.
- Feche o terminal ao terminar (a service_role não fica salva em arquivo).

## 6. Alerta de worker parado (Healthchecks.io) ⚙️

Um worker parado não consegue avisar ninguém — quem avisa é o monitor externo
que ele pinga a cada minuto (regra P10).

- [ ] Conta em [healthchecks.io](https://healthchecks.io) → **Add Check**:
      Period **1 minuto**, Grace **5 minutos**, nome "JuriFlow worker".
- [ ] **Integrations**: e-mail já vem ligado; Telegram também é gratuito
      (WhatsApp e SMS são só nos planos pagos do Healthchecks).
- [ ] Copiar a URL de ping (`https://hc-ping.com/<uuid>`) para
      `HEALTHCHECK_PING_URL` no `.env` do worker e
      `docker compose up -d` de novo.
- [ ] Teste: `docker compose stop scraper-worker` → o aviso chega em ~6 min;
      `docker compose start scraper-worker` → aviso de volta ao normal.

O painel da plataforma (dashboard do SUPER_ADMIN) também mostra
"Worker de coleta: No ar/Parado" e "Consulta ao TJAM: OK/Falhando".

## 7. Smoke test (depois de tudo no ar)

1. SUPER_ADMIN → **Administração → Novo escritório** com um e-mail real →
   e-mail chega; na lista aparece "Não aberto".
2. Abrir o link → "Bem-vindo ao JuriFlow" (lista vira "Link aberto") →
   completar escritório, nome, telefone e senha → dashboard do escritório.
3. Reenviar o convite e abrir o link antigo → "Link inválido".
4. ADMIN → **WhatsApp → Conectar** → QR code aparece → ler pelo celular →
   "Conectado".
5. Cadastrar um processo do TJAM com CNJ real, sincronização ligada, e
   escolher os tipos avisados → **Consultar agora** → no painel da plataforma,
   "Consulta ao TJAM: OK"; no WhatsApp do responsável chega **uma** mensagem
   com a lista das movimentações filtradas.
6. "Esqueci minha senha" → e-mail em português chega.
7. Parar o worker por 6 min → aviso do Healthchecks chega.

## 8. Operação

- **Backups**: o Supabase Free não tem. Até migrar para o Pro, faça um dump
  semanal no seu computador e guarde fora da máquina do worker:

  ```bash
  npx supabase db dump --linked -f backup-$(date +%F).sql          # estrutura
  npx supabase db dump --linked --data-only -f dados-$(date +%F).sql # dados
  ```

  O arquivo de dados contém dados pessoais (LGPD): guarde criptografado.

- **Projeto pausado** (Free, 7 dias sem uso): no painel do Supabase,
  **Restore project**. Com o worker no ar, o batimento evita a pausa.
- **Logs do worker**: `docker compose logs -f scraper-worker`.
- **WhatsApp desconectou**: o ADMIN reconecta em WhatsApp → Conectar.

## 9. Quando pagar

| Sinal                            | Mudança                                              | Custo aproximado |
| -------------------------------- | ---------------------------------------------------- | ---------------- |
| Primeiro cliente pagante         | Supabase **Pro** (backup diário, sem pausa)          | US$ 25/mês       |
| Mais de 100 e-mails/dia          | Resend Pro                                           | US$ 20/mês       |
| Máquina de casa instável         | VPS pequena (4 GB) — refazer o teste da seção 7      | ~US$ 5–10/mês    |
| TJAM bloqueando o IP do servidor | Espaçar mais as consultas; avaliar proxy residencial | variável         |
