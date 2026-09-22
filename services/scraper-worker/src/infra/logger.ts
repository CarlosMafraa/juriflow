/* eslint-disable no-console -- este é o único módulo que deve tocar console.* diretamente. */

export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

const LEVEL_RANK: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Logger estruturado (JSON por linha) — sem dependência externa para o MVP. */
export function createLogger(minLevel: string): Logger {
  const threshold = LEVEL_RANK[minLevel] ?? LEVEL_RANK['info'];

  const write = (
    level: 'info' | 'warn' | 'error',
    message: string,
    context?: Record<string, unknown>,
  ): void => {
    if (LEVEL_RANK[level] < threshold) return;
    const line = JSON.stringify({ level, message, time: new Date().toISOString(), ...context });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };

  return {
    info: (message, context) => write('info', message, context),
    warn: (message, context) => write('warn', message, context),
    error: (message, context) => write('error', message, context),
  };
}
