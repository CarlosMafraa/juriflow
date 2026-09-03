import { describe, expect, it } from 'vitest';
import { AuthorizationError, assertCan, can, effectiveRole } from './access.js';
import { PERMISSION_MATRIX, PERMISSIONS } from './permissions.js';
import type { AuthSubject } from './subject.js';

const SPACE_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SPACE_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const superAdmin: AuthSubject = {
  userId: 'user-super',
  isSuperAdmin: true,
  memberships: [],
};

const adminOfA: AuthSubject = {
  userId: 'user-admin-a',
  isSuperAdmin: false,
  memberships: [{ spaceId: SPACE_A, role: 'ADMIN', status: 'active' }],
};

const colaboradorOfA: AuthSubject = {
  userId: 'user-colab-a',
  isSuperAdmin: false,
  memberships: [{ spaceId: SPACE_A, role: 'COLABORADOR', status: 'active' }],
};

const disabledAdminOfA: AuthSubject = {
  userId: 'user-disabled-a',
  isSuperAdmin: false,
  memberships: [{ spaceId: SPACE_A, role: 'ADMIN', status: 'disabled' }],
};

describe('effectiveRole', () => {
  it('resolve SUPER_ADMIN independentemente do espaço', () => {
    expect(effectiveRole(superAdmin)).toBe('SUPER_ADMIN');
    expect(effectiveRole(superAdmin, SPACE_A)).toBe('SUPER_ADMIN');
  });

  it('resolve o papel do vínculo ativo no espaço', () => {
    expect(effectiveRole(adminOfA, SPACE_A)).toBe('ADMIN');
    expect(effectiveRole(colaboradorOfA, SPACE_A)).toBe('COLABORADOR');
  });

  it('retorna null sem espaço para usuário não-super', () => {
    expect(effectiveRole(adminOfA)).toBeNull();
  });

  it('retorna null para espaço onde não há vínculo ativo', () => {
    expect(effectiveRole(adminOfA, SPACE_B)).toBeNull();
    expect(effectiveRole(disabledAdminOfA, SPACE_A)).toBeNull();
  });
});

describe('can — isolamento por espaço', () => {
  it('ADMIN só administra o próprio espaço', () => {
    expect(can(adminOfA, 'space.manage', { spaceId: SPACE_A })).toBe(true);
    expect(can(adminOfA, 'space.manage', { spaceId: SPACE_B })).toBe(false);
  });

  it('COLABORADOR nunca recebe privilégios administrativos', () => {
    const adminPermissions = [
      'space.manage',
      'member.invite',
      'member.role.update',
      'member.deactivate',
      'member.remove',
      'audit.view',
    ] as const;
    for (const permission of adminPermissions) {
      expect(can(colaboradorOfA, permission, { spaceId: SPACE_A })).toBe(false);
    }
    expect(can(colaboradorOfA, 'space.view', { spaceId: SPACE_A })).toBe(true);
    expect(can(colaboradorOfA, 'member.view', { spaceId: SPACE_A })).toBe(true);
  });

  it('permissão com escopo de espaço sem spaceId falha fechada', () => {
    expect(can(adminOfA, 'space.manage')).toBe(false);
  });

  it('vínculo desabilitado não concede nada', () => {
    expect(can(disabledAdminOfA, 'space.view', { spaceId: SPACE_A })).toBe(false);
  });
});

describe('can — SUPER_ADMIN (RN7)', () => {
  it('administra a plataforma', () => {
    expect(can(superAdmin, 'platform.admin')).toBe(true);
    expect(can(superAdmin, 'space.create')).toBe(true);
    expect(can(superAdmin, 'space.suspend')).toBe(true);
    expect(can(superAdmin, 'audit.view.global')).toBe(true);
  });

  it('NÃO recebe permissões operacionais de espaço, mesmo com spaceId', () => {
    expect(can(superAdmin, 'space.manage', { spaceId: SPACE_A })).toBe(false);
    expect(can(superAdmin, 'member.invite', { spaceId: SPACE_A })).toBe(false);
    expect(can(superAdmin, 'member.remove', { spaceId: SPACE_A })).toBe(false);
    expect(can(superAdmin, 'audit.view', { spaceId: SPACE_A })).toBe(false);
  });
});

describe('assertCan', () => {
  it('não lança quando autorizado', () => {
    expect(() => assertCan(adminOfA, 'member.invite', { spaceId: SPACE_A })).not.toThrow();
  });

  it('lança AuthorizationError quando negado', () => {
    expect(() => assertCan(colaboradorOfA, 'member.invite', { spaceId: SPACE_A })).toThrow(
      AuthorizationError,
    );
  });
});

describe('matriz de permissões', () => {
  it('só referencia permissões do catálogo', () => {
    const known = new Set<string>(PERMISSIONS);
    for (const [role, perms] of Object.entries(PERMISSION_MATRIX)) {
      for (const p of perms) {
        expect(known.has(p), `${role} -> ${p}`).toBe(true);
      }
    }
  });
});
