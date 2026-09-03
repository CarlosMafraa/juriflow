import type { EffectiveRole } from '@juriflow/shared-types';

/**
 * Catálogo de permissões da FUNDAÇÃO (Fase 2).
 *
 * Permissões de negócio (processos, clientes, movimentações, regras, templates,
 * WAHA, auditoria de negócio) serão adicionadas nas fases seguintes — este
 * catálogo é a única fonte de verdade e deve crescer aqui, nunca com checagens
 * de papel espalhadas pelo código. Ver ADR-0003.
 *
 * Convenção: `recurso.acao[.escopo]`. Permissões de plataforma não dependem de
 * um espaço; as demais são avaliadas dentro de um `spaceId`.
 */
export const PERMISSIONS = [
  // Plataforma (SUPER_ADMIN) — sem acesso a conteúdo operacional (RN7).
  'platform.admin',
  'space.create',
  'space.suspend',
  'audit.view.global',

  // Espaço
  'space.view',
  'space.manage',

  // Membros (gestão pertence ao ADMIN do espaço)
  'member.view',
  'member.invite',
  'member.role.update',
  'member.deactivate',
  'member.remove',

  // Auditoria do próprio espaço
  'audit.view',

  // Perfil próprio (qualquer usuário autenticado)
  'profile.view_own',
  'profile.update_own',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Permissões que NÃO dependem de um espaço. */
export const PLATFORM_PERMISSIONS: readonly Permission[] = [
  'platform.admin',
  'space.create',
  'space.suspend',
  'audit.view.global',
];

export function isPlatformPermission(permission: Permission): boolean {
  return PLATFORM_PERMISSIONS.includes(permission);
}

/**
 * Matriz papel -> permissões. Declarativa e exaustiva por papel.
 *
 * SUPER_ADMIN (RN7): opera a plataforma, mas NÃO recebe `space.manage`,
 * `member.*` nem `audit.view` de espaço — nada que dê acesso ao conteúdo
 * operacional de um tenant.
 */
export const PERMISSION_MATRIX: Record<EffectiveRole, readonly Permission[]> = {
  SUPER_ADMIN: [
    'platform.admin',
    'space.create',
    'space.suspend',
    'space.view',
    'audit.view.global',
    'profile.view_own',
    'profile.update_own',
  ],
  ADMIN: [
    'space.view',
    'space.manage',
    'member.view',
    'member.invite',
    'member.role.update',
    'member.deactivate',
    'member.remove',
    'audit.view',
    'profile.view_own',
    'profile.update_own',
  ],
  COLABORADOR: ['space.view', 'member.view', 'profile.view_own', 'profile.update_own'],
};
