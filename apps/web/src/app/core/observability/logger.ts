/* eslint-disable no-console -- este é o único ponto autorizado a usar console */
import { Injectable, inject } from '@angular/core';
import { APP_CONFIG } from '../config/app-config';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACT_KEYS = [
  'password',
  'token',
  'apikey',
  'api_key',
  'authorization',
  'access_token',
  'refresh_token',
  'secret',
  'anonkey',
  'service_role',
];

/** Substitui valores de chaves sensíveis por `[REDACTED]` (recursivo, com corte de profundidade). */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.includes(k.toLowerCase()) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Logger estruturado (JSON). Único ponto de log da aplicação — `console.log`
 * solto é bloqueado pelo lint. Ver ADR-0006.
 */
@Injectable({ providedIn: 'root' })
export class Logger {
  private readonly config = inject(APP_CONFIG);

  debug(msg: string, context?: Record<string, unknown>, requestId?: string): void {
    this.write('debug', msg, context, requestId);
  }
  info(msg: string, context?: Record<string, unknown>, requestId?: string): void {
    this.write('info', msg, context, requestId);
  }
  warn(msg: string, context?: Record<string, unknown>, requestId?: string): void {
    this.write('warn', msg, context, requestId);
  }
  error(msg: string, context?: Record<string, unknown>, requestId?: string): void {
    this.write('error', msg, context, requestId);
  }

  private write(
    level: LogLevel,
    msg: string,
    context?: Record<string, unknown>,
    requestId?: string,
  ): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.config.logLevel]) return;

    const entry = {
      level,
      msg,
      ts: new Date().toISOString(),
      ...(requestId ? { requestId } : {}),
      ...(context ? { context: redact(context) } : {}),
    };
    const line = JSON.stringify(entry);

    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else if (level === 'info') console.info(line);
    else console.debug(line);
  }
}
