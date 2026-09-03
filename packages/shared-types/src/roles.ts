/**
 * Papéis de acesso do JuriFlow.
 *
 * Regras da Fase 1 (DEFINIDO):
 *  - SUPER_ADMIN atua globalmente e NÃO é um papel dentro de um espaço.
 *    É modelado como um atributo de plataforma (`profiles.is_super_admin`),
 *    não como linha em `space_members`. Ver ADR-0003 e PP-01.
 *  - ADMIN e COLABORADOR são papéis SEMPRE relativos a um espaço (`space_members.role`).
 */

/** Papéis atribuíveis a um membro dentro de um espaço. */
export const SPACE_ROLES = ['ADMIN', 'COLABORADOR'] as const;
export type SpaceRole = (typeof SPACE_ROLES)[number];

/** Papel de plataforma (fora do escopo de espaço). */
export const PLATFORM_ROLE = 'SUPER_ADMIN' as const;
export type PlatformRole = typeof PLATFORM_ROLE;

/**
 * Papel efetivo usado para resolver permissões na UI e no domínio.
 * Combina o papel de plataforma com o papel no espaço ativo.
 */
export type EffectiveRole = PlatformRole | SpaceRole;

export function isSpaceRole(value: string): value is SpaceRole {
  return (SPACE_ROLES as readonly string[]).includes(value);
}

/** Situação do vínculo de um usuário com um espaço. */
export const SPACE_MEMBER_STATUSES = ['active', 'invited', 'disabled'] as const;
export type SpaceMemberStatus = (typeof SPACE_MEMBER_STATUSES)[number];
