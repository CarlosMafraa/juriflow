import { inject } from '@angular/core';
import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { Logger } from '../observability/logger';
import { ToastService } from '../../shared/feedback/toast.service';

/** Normaliza, registra (com request id) e notifica falhas HTTP. */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const logger = inject(Logger);
  const toast = inject(ToastService);
  const header = inject(APP_CONFIG).requestIdHeader;

  return next(req).pipe(
    catchError((error: unknown) => {
      const requestId = req.headers.get(header) ?? undefined;

      if (error instanceof HttpErrorResponse) {
        logger.error('Falha HTTP', { url: req.url, status: error.status }, requestId);

        if (error.status === 0) {
          toast.error('Sem conexão com o servidor.');
        } else if (error.status === 401) {
          toast.error('Sessão expirada. Entre novamente.');
        } else if (error.status === 403) {
          toast.error('Você não tem permissão para esta ação.');
        } else if (error.status >= 500) {
          toast.error('Erro no servidor. Tente novamente em instantes.');
        } else {
          toast.error('Não foi possível concluir a operação.');
        }
      } else {
        logger.error('Erro não-HTTP na requisição', { url: req.url }, requestId);
      }

      return throwError(() => error);
    }),
  );
};
