/**
 * Única porta de entrada do processo para variáveis de ambiente. Nenhum outro
 * módulo lê `process.env` diretamente — troca de fonte de configuração
 * (ex.: secrets manager) fica isolada aqui.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : fallback;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw.trim().toLowerCase() === 'true';
}

export interface WorkerConfig {
  readonly supabaseUrl: string;
  readonly supabaseServiceRoleKey: string;

  readonly wahaBaseUrl: string;
  readonly wahaApiKey: string;
  /** Intervalo do polling de whatsapp_sessions (conectar/desconectar/status). */
  readonly wahaSessionPollMs: number;
  /** Intervalo da conferência das sessões conectadas (queda pelo celular). */
  readonly wahaHealthPollMs: number;

  /** false = navegador com janela (Xvfb no container): o firewall do TJAM rejeita headless. */
  readonly scraperHeadless: boolean;
  /** Intervalo mínimo entre consultas a processos, para não sobrecarregar a fonte. */
  readonly scraperThrottleMs: number;
  /** Pausa aleatória entre mensagens de WhatsApp (docs do WAHA: 30–60 s), anti-bloqueio. */
  readonly whatsappMinIntervalMs: number;
  readonly whatsappMaxIntervalMs: number;

  readonly dailyCheckCron: string;
  /** Parabéns de aniversário: de hora em hora das 9h às 20h (quem ficou sem, recebe na próxima). */
  readonly birthdayCron: string;
  /** Fuso do cron diário — o container roda em UTC; sem isso "08:00" vira 04:00 em Manaus. */
  readonly dailyCheckTimezone: string;
  /**
   * Intervalo do polling de pedidos de "consultar agora" (processes.check_requested_at)
   * e da fila de avisos pendentes (notification_catchup_requests).
   */
  readonly checkRequestPollMs: number;
  readonly httpPort: number;
  /**
   * URL do monitor externo (ex.: Healthchecks.io) pingada a cada minuto.
   * Se os pings param, o monitor avisa que o worker caiu (regra P10).
   */
  readonly healthcheckPingUrl: string | null;
  readonly logLevel: string;
}

export function loadConfig(): WorkerConfig {
  return {
    supabaseUrl: required('SUPABASE_URL'),
    supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),

    wahaBaseUrl: required('WAHA_BASE_URL'),
    wahaApiKey: required('WAHA_API_KEY'),
    wahaSessionPollMs: optionalInt('WAHA_SESSION_POLL_MS', 5000),
    wahaHealthPollMs: optionalInt('WAHA_HEALTH_POLL_MS', 60_000),

    scraperHeadless: optionalBool('SCRAPER_HEADLESS', false),
    scraperThrottleMs: optionalInt('SCRAPER_THROTTLE_MS', 4000),
    whatsappMinIntervalMs: optionalInt('WHATSAPP_MIN_INTERVAL_MS', 30_000),
    whatsappMaxIntervalMs: optionalInt('WHATSAPP_MAX_INTERVAL_MS', 60_000),

    dailyCheckCron: optional('DAILY_CHECK_CRON', '0 8 * * *'),
    birthdayCron: optional('BIRTHDAY_CRON', '0 9-20 * * *'),
    dailyCheckTimezone: optional('DAILY_CHECK_TIMEZONE', 'America/Manaus'),
    checkRequestPollMs: optionalInt('CHECK_REQUEST_POLL_MS', 10000),
    httpPort: optionalInt('HTTP_PORT', 3000),
    healthcheckPingUrl: process.env['HEALTHCHECK_PING_URL']?.trim() || null,
    logLevel: optional('LOG_LEVEL', 'info'),
  };
}
