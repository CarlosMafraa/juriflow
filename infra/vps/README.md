# Infra da VPS — WAHA + scraper-worker (MVP)

Uma VPS única roda 2 containers via Docker Compose: o WAHA (sessão do
WhatsApp) e o `scraper-worker` (coleta Projudi/TJAM + envio de notificações).
O banco (Supabase) fica na nuvem, fora desta VPS.

## Pré-requisitos na VPS

- Docker + Docker Compose plugin instalados.
- Acesso SSH (para o túnel do QR code — nunca exponha as portas publicamente).

## Passo a passo

1. **Supabase Cloud** (fora desta VPS, uma vez só):

   ```bash
   npx supabase link --project-ref <seu-projeto>
   npx supabase db push
   ```

   Copie a `service_role` key do painel do projeto (Settings → API) — vai para
   `SUPABASE_SERVICE_ROLE_KEY` abaixo. **Nunca** essa key no frontend.

2. **Clonar o repo na VPS** e copiar o env:

   ```bash
   cp infra/vps/.env.example infra/vps/.env
   # editar infra/vps/.env com os valores reais (Supabase, WAHA_API_KEY forte)
   ```

3. **Subir os containers**:

   ```bash
   cd infra/vps
   docker compose up -d --build
   ```

4. **Conectar o WhatsApp (QR code)** — feito pelo ADMIN de cada espaço, direto
   no app, em `/configuracoes/whatsapp`: ele clica em "Conectar", o
   scraper-worker abre uma sessão nomeada para aquele espaço no WAHA (rede
   interna do compose), busca o QR code e grava em `whatsapp_sessions`
   (Supabase); a tela do app mostra o QR e atualiza o status assim que a
   sessão conecta. A porta do WAHA não é exposta publicamente — só o
   scraper-worker fala com ele. Para depuração administrativa avulsa (não é
   o fluxo normal de conexão), ainda é possível abrir um túnel SSH:

   ```bash
   ssh -L 3000:localhost:3000 usuario@sua-vps
   ```

5. **Verificar que o worker está no ar** (ainda pelo túnel, na porta do
   worker — ajuste a porta local do túnel se usar as duas ao mesmo tempo):
   ```bash
   curl http://localhost:3000/health
   ```

## Operação

- Logs: `docker compose logs -f scraper-worker`
- A rotina diária roda sozinha (cron dentro do próprio worker, `DAILY_CHECK_CRON`).
- Para forçar uma coleta manual antes do frontend ter o botão: túnel SSH até a
  porta do worker e `curl -X POST http://localhost:<porta>/check/<process-id>`.
- Atualização de código: `git pull && docker compose up -d --build`.

## Fora do escopo desta fase

Rate limiting/CSP no worker (RN seção 16, "Hardening"), rotação de secrets,
HTTPS público (não há endpoint público ainda), múltiplas VPS/alta
disponibilidade.
