import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { PermissionService } from './permission.service';
import { permissionGuard } from './permission.guard';

function run(opts: { authenticated: boolean; allowed: boolean }): unknown {
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { isAuthenticated: signal(opts.authenticated) } },
      { provide: PermissionService, useValue: { canNow: () => opts.allowed } },
      {
        provide: Router,
        useValue: { createUrlTree: (cmds: unknown[]) => ({ cmds }) },
      },
    ],
  });
  const guard = permissionGuard('audit.view');
  return TestBed.runInInjectionContext(() =>
    guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
  );
}

describe('permissionGuard', () => {
  it('libera quando autenticado e com permissão', () => {
    expect(run({ authenticated: true, allowed: true })).toBe(true);
  });

  it('manda para /forbidden quando autenticado sem permissão', () => {
    expect(run({ authenticated: true, allowed: false })).toEqual({ cmds: ['/forbidden'] });
  });

  it('manda para /login quando não autenticado', () => {
    expect(run({ authenticated: false, allowed: true })).toEqual({ cmds: ['/login'] });
  });
});
