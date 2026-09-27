import { ErrorHandler, Injectable, inject } from '@angular/core';
import { Logger } from './logger';

const RELOAD_FLAG = 'juriflow.chunkReloadAt';

/**
 * Erros não tratados passam por aqui (e não direto no console): um único
 * ponto para plugar um serviço de monitoramento (ex.: Sentry) depois.
 *
 * Caso especial: após um deploy, uma aba aberta antes dele tenta baixar um
 * chunk lazy com hash antigo que não existe mais. Recarregar a página resolve —
 * uma vez só a cada minuto, para não entrar em loop se o problema for outro.
 */
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly logger = inject(Logger);

  handleError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);

    if (isStaleChunkError(message) && this.tryReloadOnce()) return;

    this.logger.error('Erro não tratado', {
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  private tryReloadOnce(): boolean {
    try {
      const last = Number(sessionStorage.getItem(RELOAD_FLAG) ?? 0);
      if (Date.now() - last < 60_000) return false;
      sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
    } catch {
      return false;
    }
    location.reload();
    return true;
  }
}

function isStaleChunkError(message: string): boolean {
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    message,
  );
}
