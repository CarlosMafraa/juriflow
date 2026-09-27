# O que o JuriFlow precisa para funcionar

Inventário de **tudo** que a aplicação precisa: serviços, máquinas, versões,
rede, segredos e o que cada escritório cliente precisa ter. O **como** instalar
está em [DEPLOY.md](DEPLOY.md); as **regras** do produto, em
[REGRAS-DE-NEGOCIO.md](REGRAS-DE-NEGOCIO.md).

Levantado do código em 26/09/2026. Mudou versão, porta, variável ou serviço?
Atualize este documento no mesmo commit.

## 1. As peças

```
 Navegador (ADMIN, colaborador, plataforma)
        │  HTTPS
        ▼
 Frontend — SPA Angular (Cloudflare Workers, só estático)
        │  HTTPS (supabase-js, chave anon)
        ▼
 Supabase — Postgres + Auth + Storage + Edge Function
        ▲  HTTPS (chave service_role)          │ SMTP
        │                                      ▼
 Worker de coleta ──── HTTP interno ──── WAHA         Resend → e-mails
 (Docker, servidor sempre ligado)        (Docker)
   │ HTTPS                                 │
   ▼                                       ▼
 Consulta pública do TJAM          Servidores do WhatsApp
   │
   └─ ping a cada minuto → Healthchecks.io → avisa se o worker parar
```

O frontend **nunca** fala com o worker nem com o WAHA: tudo passa pelo banco
(filas em `whatsapp_sessions` e `processes.check_requested_at`).

## 2. Infraestrutura do servidor do worker (medida)

É a única máquina que você mantém: roda o **worker** e o **WAHA** em Docker.
Frontend e banco ficam em serviços gerenciados (Cloudflare e Supabase) — não
consomem nada da sua máquina.

### Quanto cada container usou (medido em 26/09/2026)

Medição com `docker stats` nas imagens de produção, no Docker Desktop (WSL2):

| Container       | Situação                                          | Memória          | CPU                                   |
| --------------- | ------------------------------------------------- | ---------------- | ------------------------------------- |
| **WAHA** (GOWS) | ocioso                                            | ~420 MB          | ~0%                                   |
| **WAHA** (GOWS) | 5 sessões aguardando QR code                      | ~440 MB          | ~0%                                   |
| **Worker**      | parado, navegador aberto após a 1ª consulta       | ~250 MB          | ~0%                                   |
| **Worker**      | **consultando o TJAM** (Chromium com janela/Xvfb) | **pico ~540 MB** | ~77% de 1 núcleo, por poucos segundos |

- Consulta real do processo 0280181-52.2025.8.04.1000: **74 movimentações em
  7,7 s**, a partir do container, passando pelo firewall do TJAM.
- Sessões de WhatsApp **conectadas** usam mais que as aguardando QR (não
  medido — exige celulares). Conte com algumas dezenas de MB por escritório.
- O worker consulta **um processo por vez** (fila única): o pico não cresce
  com o número de processos, só a duração da rotina diária.

### Requisitos da máquina

| Recurso      | Mínimo                                           | Recomendado           | Por quê                                                                                                             |
| ------------ | ------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Memória**  | **2 GB livres**                                  | **4 GB livres**       | Medido ~1 GB (WAHA ~0,45 + worker ~0,55 no pico); a folga cobre sistema, Docker e sessões conectadas                |
| **CPU**      | 1 núcleo                                         | 2 núcleos             | O pico é curto (~8 s por processo); o resto do tempo fica perto de 0%                                               |
| **Disco**    | **10 GB livres**                                 | **20 GB livres**      | Imagens: WAHA 3,2 GB + worker 3,6 GB; atualizações baixam imagem nova antes de apagar a antiga, mais logs e sessões |
| **Internet** | Estável, sempre ligada                           | Cabo/fibra            | Tráfego baixo (páginas do TJAM + mensagens de texto)                                                                |
| **IP**       | —                                                | **Residencial**       | O firewall do TJAM bloqueia consultas seguidas; o IP de casa passou no teste                                        |
| **Energia**  | Sem suspensão/hibernação                         | Nobreak               | Se a máquina dormir, nada é coletado nem enviado (o Healthchecks avisa)                                             |
| **Sistema**  | Linux ou Windows 10/11 com Docker Desktop (WSL2) | Linux (Ubuntu 22.04+) | Linux consome menos memória que Docker Desktop no Windows                                                           |

No Windows, o Docker Desktop reserva memória para a VM do WSL2 (por padrão
até metade da RAM do computador): em máquina de 8 GB isso já basta; em 4 GB,
feche outros programas pesados.

### Exemplos de máquina que servem

| Opção                                       | Serve?    | Observação                                                                                          |
| ------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------- |
| PC/notebook de casa com 8 GB, sempre ligado | sim       | O mais simples para começar                                                                         |
| Mini PC (ex.: Intel N100, 8–16 GB)          | sim       | Baixo consumo de energia, ideal para ficar ligado 24 h                                              |
| Raspberry Pi 4/5 com 4–8 GB                 | talvez    | ARM: WAHA tem imagem ARM (`gows-arm`); a imagem do worker precisa ser gerada para ARM — não testado |
| VPS 2 GB                                    | no limite | Funciona pelo medido, sem folga                                                                     |
| VPS 4 GB                                    | sim       | IP de datacenter: testar o TJAM antes de ter clientes (regra F4)                                    |

## 3. Contas e serviços externos

| Serviço             | Para quê                                                                      | Plano inicial        | Obrigatório        |
| ------------------- | ----------------------------------------------------------------------------- | -------------------- | ------------------ |
| **Supabase**        | Banco, login, arquivos (avatar), função de convite                            | Free → Pro (US$ 25)  | sim                |
| **Cloudflare**      | Hospedar o frontend (Workers, só arquivos estáticos)                          | Free                 | sim                |
| **Resend**          | Enviar e-mails de convite e de senha (SMTP)                                   | Free (100/dia)       | sim                |
| **Domínio próprio** | Remetente dos e-mails (sem ele o Resend só envia para você) e endereço do app | ~R$ 40/ano (.com.br) | sim, para clientes |
| **Healthchecks.io** | Avisar se o worker parar                                                      | Free                 | recomendado        |
| **GitHub**          | Código; a Cloudflare faz o build a partir dele                                | Free                 | sim                |
| **WhatsApp**        | Um número por escritório, conectado ao WAHA                                   | —                    | sim                |

## 4. Frontend

| Item        | Requisito                                                                   |
| ----------- | --------------------------------------------------------------------------- |
| Tecnologia  | Angular 18, PrimeNG 18, Chart.js 4, supabase-js 2                           |
| Hospedagem  | Qualquer hospedagem de arquivos estáticos com fallback de SPA e HTTPS       |
| Build       | Node **22** (mínimo 20.11); `npm ci && npm run build`                       |
| Saída       | `apps/web/dist/web/browser` (~arquivos estáticos, sem servidor)             |
| Variáveis   | `WEB_SUPABASE_URL`, `WEB_SUPABASE_ANON_KEY`, `REQUIRE_WEB_ENV=true` (build) |
| Cabeçalhos  | `apps/web/public/_headers` (HSTS, nosniff, sem iframe)                      |
| Fala com    | Só o Supabase (HTTPS). Não usa Realtime/WebSocket.                          |
| Navegadores | Chrome, Edge, Firefox e Safari atuais; funciona em celular                  |

## 5. Supabase (banco, Auth, Storage, função)

| Item             | Requisito                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres         | **15**                                                                                                                                         |
| Extensões        | `citext`, `pg_trgm` (criadas pelas migrations)                                                                                                 |
| Migrations       | `supabase/migrations`, 0001 a 0044, aplicadas em ordem (`supabase db push`)                                                                    |
| Auth             | Provedor **e-mail** ligado; cadastro aberto **desligado**; confirmar e-mail **ligado**; senha ≥ 8 com letras e números; link (OTP) de **24 h** |
| E-mail           | **SMTP próprio** (Resend) + os 3 templates de `supabase/templates`                                                                             |
| Storage          | Bucket `avatars` (criado pela migration 0028/0031)                                                                                             |
| Edge Function    | `send-invite` (Deno), com o secret `APP_SITE_URL`                                                                                              |
| Região           | São Paulo (`sa-east-1`)                                                                                                                        |
| Tamanho estimado | Poucos MB por escritório no início; o Free comporta 500 MB                                                                                     |
| Atenção (Free)   | Pausa após 7 dias sem uso; **sem backup** — ver DEPLOY.md, seção 8                                                                             |

## 6. Worker de coleta (`services/scraper-worker`)

O que ele faz: consulta a página pública do TJAM, guarda as movimentações
novas, decide quem avisar (filtros por tipo) e envia pelo WhatsApp (via WAHA);
também atende "Conectar WhatsApp" e "Consultar agora" do app.

### Máquina

| Item            | Requisito                                                                               |
| --------------- | --------------------------------------------------------------------------------------- |
| Disponibilidade | **Sempre ligada** (sem suspender/hibernar); reinício automático dos containers          |
| Sistema         | Linux (recomendado) ou Windows com Docker Desktop (WSL2)                                |
| Docker          | Docker Engine + Docker Compose v2                                                       |
| CPU             | 1 núcleo (mín.) / 2 (recomendado) — ver seção 2                                         |
| Memória         | **2 GB livres (mín.) / 4 GB (recomendado)** para worker + WAHA — medido ~1 GB no pico   |
| Disco           | **10 GB (mín.) / 20 GB (recomendado)** — imagens: worker 3,6 GB + WAHA 3,2 GB           |
| IP              | **Residencial recomendado**: o firewall do TJAM bloqueia com facilidade (regra F4)      |
| Fuso            | Indiferente — o horário da rotina vem de `DAILY_CHECK_TIMEZONE` (padrão America/Manaus) |

### Dentro do container

| Item                  | Versão / detalhe                                                                     |
| --------------------- | ------------------------------------------------------------------------------------ |
| Imagem base           | `mcr.microsoft.com/playwright:v1.63.0-jammy` (Ubuntu 22.04)                          |
| Node                  | o da imagem do Playwright (≥ 20)                                                     |
| Navegador             | Chromium do Playwright 1.63.0, **com janela** sob `xvfb-run` (TJAM rejeita headless) |
| Memória compartilhada | `shm_size: 1gb` e `init: true` no compose (recomendação do Playwright)               |
| Portas                | 3000 **interna** — nenhuma porta publicada                                           |

### Rede (só conexões de saída)

| Destino                                | Protocolo | Para quê                             |
| -------------------------------------- | --------- | ------------------------------------ |
| `https://<ref>.supabase.co`            | HTTPS     | Ler e gravar no banco (service_role) |
| `https://projudi-consulta.tjam.jus.br` | HTTPS     | **Única fonte de dados** (regra F1)  |
| `http://waha:3000`                     | HTTP      | Rede interna do compose              |
| `https://hc-ping.com`                  | HTTPS     | Batimento para o monitor externo     |

### Rotinas e ritmos

| Rotina              | Quando                                | Limite / cuidado                                         |
| ------------------- | ------------------------------------- | -------------------------------------------------------- |
| Rotina diária       | `DAILY_CHECK_CRON` (08:00 Manaus)     | `SCRAPER_THROTTLE_MS` entre processos (recomendado 60 s) |
| "Consultar agora"   | a cada `CHECK_REQUEST_POLL_MS` (10 s) | Mínimo 5 min entre consultas do mesmo processo (banco)   |
| Sessões do WhatsApp | a cada `WAHA_SESSION_POLL_MS` (5 s)   | —                                                        |
| Batimento           | a cada 1 min                          | Banco + `HEALTHCHECK_PING_URL`                           |
| Envio de mensagens  | ao detectar movimentação nova         | 30–60 s entre mensagens + "digitando…" (regra N9)        |
| Reenvio de falhas   | a cada consulta do processo           | Até 5 tentativas por aviso (regra N7)                    |

### Segredos que ele guarda (`infra/vps/.env`)

`SUPABASE_SERVICE_ROLE_KEY` 🔒 (ignora a RLS) e `WAHA_API_KEY` 🔒. Lista
completa de variáveis em [DEPLOY.md](DEPLOY.md#servidor-do-worker--arquivo-infravpsenv-nunca-versionado).

## 7. WAHA (WhatsApp)

| Item      | Requisito                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------- |
| Imagem    | `devlikeapro/waha:gows-2026.9.1` **fixada por digest** — nunca `latest`                            |
| Motor     | **GOWS** (sem navegador; gratuito desde a versão 2026.6.1, com sessões ilimitadas)                 |
| Sessões   | Uma por escritório (`space_<id>`)                                                                  |
| Dados     | Volume `waha_sessions` — **não apagar**: perder o volume desconecta todos os escritórios (novo QR) |
| Segurança | `WAHA_API_KEY`; porta nunca publicada                                                              |
| Rede      | Saída para os servidores do WhatsApp                                                               |
| Memória   | ~420 MB ocioso, ~440 MB com 5 sessões aguardando QR (medido)                                       |
| Risco     | API não oficial: o WhatsApp pode bloquear números que disparam demais (ver seção 8)                |

## 8. O que cada escritório cliente precisa

| Item                                 | Por quê                                                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| E-mail do ADMIN                      | Recebe o convite e configura o escritório                                                                               |
| **Número de WhatsApp dedicado**      | Conectado pelo QR code. Use um número do escritório, **não o pessoal**: se o WhatsApp bloquear, perde-se só esse número |
| Celular com esse WhatsApp ligado     | O WhatsApp exige o aparelho principal ativo de tempos em tempos                                                         |
| Telefone dos responsáveis/clientes   | No perfil e no cadastro do cliente, com DDD (+55)                                                                       |
| Autorização dos clientes (LGPD)      | Base legal para mandar WhatsApp ao cliente do escritório                                                                |
| Processos no **TJAM** com número CNJ | Única fonte na v1 (regras F1 e F3)                                                                                      |

Boas práticas do WhatsApp que o sistema já segue: mensagens agrupadas por
processo, pausa de 30–60 s entre mensagens e "digitando…" antes de enviar.

## 9. Ambiente de desenvolvimento

| Item          | Requisito                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Node          | ≥ 20.11 (testado no 24)                                                                        |
| npm           | Workspaces (vem com o Node)                                                                    |
| Docker        | Docker Desktop (stack local do Supabase, testes de banco)                                      |
| Supabase CLI  | via `npx supabase` (testado na 1.226.4)                                                        |
| Playwright    | Navegadores instalados (`npx playwright install chromium`) para os testes                      |
| Portas locais | 4200 (app), 55321 (API), 55322 (banco), 55323 (Studio), 55324 (e-mails de teste), 55327, 55329 |

Comandos de verificação antes de subir código: `npm run lint`, `npm test`,
`npm run test:web`, `npx supabase test db` e os testes de navegador (E2E).

## 10. Segredos — onde fica cada um

| Segredo                        | Onde fica                               | Nunca em                                                          |
| ------------------------------ | --------------------------------------- | ----------------------------------------------------------------- |
| Senha do banco (Supabase)      | Gerenciador de senhas                   | Repositório, `.env` do worker                                     |
| `SUPABASE_SERVICE_ROLE_KEY`    | `.env` do worker; terminal no bootstrap | Frontend, repositório, Cloudflare                                 |
| `WAHA_API_KEY`                 | `.env` do worker                        | Repositório                                                       |
| API key do Resend (senha SMTP) | Painel do Supabase (SMTP Settings)      | Repositório                                                       |
| URL do Healthchecks            | `.env` do worker                        | Repositório (quem tem a URL pode "fingir" que o worker está vivo) |
| Chave anon do Supabase         | Build variable da Cloudflare            | — (é pública; a RLS protege)                                      |

## 11. Custos

| Fase                             | Mensal                  |
| -------------------------------- | ----------------------- |
| Começo (tudo gratuito + domínio) | ~R$ 4/mês (domínio)     |
| Com clientes pagando             | + US$ 25 (Supabase Pro) |
| Se o servidor de casa não der    | + ~US$ 5–10 (VPS 4 GB)  |
| Mais de 100 e-mails/dia          | + US$ 20 (Resend Pro)   |
