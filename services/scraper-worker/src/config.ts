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
  readonly wahaSession: string;

  readonly tjamProjudiBaseUrl: string;
  readonly scraperHeadless: boolean;
  /** Intervalo mínimo entre consultas a processos, para não sobrecarregar a fonte. */
  readonly scraperThrottleMs: number;

  readonly dailyCheckCron: string;
  readonly httpPort: number;
  readonly logLevel: string;
}

export function loadConfig(): WorkerConfig {
  return {
    supabaseUrl: required('SUPABASE_URL'),
    supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),

    wahaBaseUrl: required('WAHA_BASE_URL'),
    wahaApiKey: required('WAHA_API_KEY'),
    wahaSession: optional('WAHA_SESSION', 'default'),

    tjamProjudiBaseUrl: optional(
      'TJAM_PROJUDI_BASE_URL',
      'https://projudi-consulta.tjam.jus.br/processo/consultaPublicaNova.do',
    ),
    scraperHeadless: optionalBool('SCRAPER_HEADLESS', true),
    scraperThrottleMs: optionalInt('SCRAPER_THROTTLE_MS', 4000),

    dailyCheckCron: optional('DAILY_CHECK_CRON', '0 8 * * *'),
    httpPort: optionalInt('HTTP_PORT', 3000),
    logLevel: optional('LOG_LEVEL', 'info'),
  };
}
