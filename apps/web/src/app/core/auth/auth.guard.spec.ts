import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import type { CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';
import { authGuard, guestGuard } from './auth.guard';

function run(guard: CanActivateFn, authenticated: boolean, url = '/processos'): unknown {
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { isAuthenticated: signal(authenticated) } },
      {
        provide: Router,
        useValue: { createUrlTree: (cmds: unknown[], extras?: unknown) => ({ cmds, extras }) },
      },
    ],
  });
  const route = {} as ActivatedRouteSnapshot;
  const state = { url } as RouterStateSnapshot;
  return TestBed.runInInjectionContext(() => guard(route, state));
}

describe('authGuard', () => {
  it('permite quando autenticado', () => {
    expect(run(authGuard, true)).toBe(true);
  });

  it('redireciona para /login preservando o destino quando não autenticado', () => {
    const result = run(authGuard, false, '/auditoria') as {
      cmds: string[];
      extras: { queryParams: Record<string, string> };
    };
    expect(result.cmds).toEqual(['/login']);
    expect(result.extras.queryParams['redirectTo']).toBe('/auditoria');
  });
});

describe('guestGuard', () => {
  it('permite visitantes', () => {
    expect(run(guestGuard, false)).toBe(true);
  });

  it('manda usuário logado para a home', () => {
    const result = run(guestGuard, true) as { cmds: string[] };
    expect(result.cmds).toEqual(['/']);
  });
});
