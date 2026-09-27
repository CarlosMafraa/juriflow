# Servidor do worker — WAHA + scraper-worker

Uma máquina sempre ligada roda 2 containers com Docker Compose: o **WAHA**
(sessões do WhatsApp, uma por escritório) e o **scraper-worker** (coleta na
consulta pública do TJAM + envio das notificações). O banco fica no Supabase,
fora desta máquina.

Pode ser um **computador em casa** (recomendado para começar: o firewall do
TJAM aceitou IP residencial no teste real) ou uma **VPS**. O passo a passo
completo, com o mapa de todas as variáveis, está em
[`docs/DEPLOY.md`](../../docs/DEPLOY.md) (seção 4).

## Resumo

```bash
cp .env.example .env      # preencher: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
                          # WAHA_API_KEY (openssl rand -hex 32), HEALTHCHECK_PING_URL
docker compose up -d --build
docker compose ps         # nenhuma porta 0.0.0.0 publicada
docker compose logs -f scraper-worker
```

## Como funciona

- **Nenhuma porta pública.** O app fala com o worker só pelo banco:
  "Conectar WhatsApp" grava em `whatsapp_sessions` e "Consultar agora" em
  `processes.check_requested_at`; o worker consulta essas filas.
- **WhatsApp**: o ADMIN de cada escritório conecta pelo app
  (`/configuracoes/whatsapp`) — o worker abre a sessão no WAHA, busca o QR code
  e grava no banco; a tela mostra o QR e o status.
- **TJAM**: o Chromium roda "com janela" numa tela virtual (`xvfb-run`), porque
  o firewall do tribunal rejeita navegador headless.
- **Saúde**: batimento a cada minuto no banco (painel da plataforma) e ping no
  monitor externo (`HEALTHCHECK_PING_URL`), que avisa se o worker parar.
- **Rotina diária**: `DAILY_CHECK_CRON` no fuso `DAILY_CHECK_TIMEZONE`
  (padrão 08:00, America/Manaus).

## Operação

- Logs: `docker compose logs -f scraper-worker`
- Atualizar: `git pull && docker compose up -d --build`
- Depuração avulsa (opcional, só numa VPS): túnel SSH até a porta interna,
  ex.: `ssh -L 3000:localhost:3000 usuario@servidor` e
  `curl http://localhost:3000/health`.
