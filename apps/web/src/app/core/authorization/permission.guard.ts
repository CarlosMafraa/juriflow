import { inject } from '@angular/core';
import { Router, type CanActivateFn, type UrlTree } from '@angular/router';
import type { Permission } from '@juriflow/domain';
import { AuthService } from '../auth/auth.service';
import { ActiveSpaceService } from './active-space.service';
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

/**
 * Módulo de Usuários: só quem tem `member.view` (ADMIN). Exceção: quem ainda
 * não tem espaço ativo entra para ver e aceitar os convites que recebeu.
 */
export const usersAreaGuard: CanActivateFn = (): boolean | UrlTree => {
  const auth = inject(AuthService);
  const permissions = inject(PermissionService);
  const activeSpace = inject(ActiveSpaceService);
  const router = inject(Router);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }
  if (!activeSpace.activeSpaceId()) return true;
  return permissions.canNow('member.view') ? true : router.createUrlTree(['/forbidden']);
};

/**
 * Escritório criado pela plataforma e ainda não configurado: o ADMIN completa
 * os dados (dele e do escritório) antes de usar o resto do sistema.
 */
export const setupGuard: CanActivateFn = (): boolean | UrlTree => {
  const activeSpace = inject(ActiveSpaceService);
  const router = inject(Router);
  // Logo após o login o espaço ativo ainda não foi escolhido: usa o mesmo
  // critério do ActiveSpaceService (o primeiro disponível).
  const space = activeSpace.activeSpace() ?? activeSpace.availableSpaces()[0];
  return space?.setupPending && space.role === 'ADMIN'
    ? router.createUrlTree(['/primeiro-acesso'])
    : true;
};
