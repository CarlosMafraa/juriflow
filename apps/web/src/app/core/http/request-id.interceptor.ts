import { inject } from '@angular/core';
import type { HttpInterceptorFn } from '@angular/common/http';
import { APP_CONFIG } from '../config/app-config';
import { newRequestId } from '../observability/request-id';

/** Anexa um id de correlação a cada requisição saída pelo HttpClient. */
export const requestIdInterceptor: HttpInterceptorFn = (req, next) => {
  const header = inject(APP_CONFIG).requestIdHeader;
  if (req.headers.has(header)) return next(req);
  return next(req.clone({ setHeaders: { [header]: newRequestId() } }));
};
