import { inject } from '@angular/core';
import { Router, type CanActivateFn, type UrlTree } from '@angular/router';
import type { Permission } from '@juriflow/domain';
import { AuthService } from '../auth/auth.service';
import { PermissionService } from './permission.service';

/**
 * Fábrica de guard por permissão. A UI apenas bloqueia navegação — a segurança
 * real é RLS/API (ADR-0003).
 *
 *   { path: 'audit', canActivate: [authGuard, permissionGuard('audit.view')], ... }
 */
export function permissionGuard(permission: Permission): CanActivateFn {
  return (): boolean | UrlTree => {
    const auth = inject(AuthService);
    const permissions = inject(PermissionService);
    const router = inject(Router);

    if (!auth.isAuthenticated()) {
      return router.createUrlTree(['/login']);
    }
    return permissions.canNow(permission) ? true : router.createUrlTree(['/forbidden']);
  };
}
