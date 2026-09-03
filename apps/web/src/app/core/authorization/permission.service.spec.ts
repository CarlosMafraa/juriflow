import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AuthSubject } from '@juriflow/domain';
import { AuthService } from '../auth/auth.service';
import { ActiveSpaceService } from './active-space.service';
import { PermissionService } from './permission.service';

const SPACE_A = 'space-a';
const SPACE_B = 'space-b';

function setup(subject: AuthSubject | null, activeSpaceId: string | null): PermissionService {
  TestBed.configureTestingModule({
    providers: [
      PermissionService,
      { provide: AuthService, useValue: { authSubject: signal(subject) } },
      { provide: ActiveSpaceService, useValue: { activeSpaceId: signal(activeSpaceId) } },
    ],
  });
  return TestBed.inject(PermissionService);
}

describe('PermissionService', () => {
  it('ADMIN pode administrar o espaço ativo', () => {
    const svc = setup(
      {
        userId: 'u1',
        isSuperAdmin: false,
        memberships: [{ spaceId: SPACE_A, role: 'ADMIN', status: 'active' }],
      },
      SPACE_A,
    );
    expect(svc.can('space.manage')).toBe(true);
    expect(svc.can('member.invite')).toBe(true);
  });

  it('ADMIN não administra um espaço diferente do ativo', () => {
    const svc = setup(
      {
        userId: 'u1',
        isSuperAdmin: false,
        memberships: [{ spaceId: SPACE_A, role: 'ADMIN', status: 'active' }],
      },
      SPACE_A,
    );
    expect(svc.can('space.manage', SPACE_B)).toBe(false);
  });

  it('COLABORADOR não recebe permissões administrativas', () => {
    const svc = setup(
      {
        userId: 'u2',
        isSuperAdmin: false,
        memberships: [{ spaceId: SPACE_A, role: 'COLABORADOR', status: 'active' }],
      },
      SPACE_A,
    );
    expect(svc.can('space.view')).toBe(true);
    expect(svc.can('space.manage')).toBe(false);
    expect(svc.can('audit.view')).toBe(false);
    expect(svc.can('member.remove')).toBe(false);
  });

  it('SUPER_ADMIN administra a plataforma mas não o conteúdo do espaço', () => {
    const svc = setup({ userId: 's1', isSuperAdmin: true, memberships: [] }, null);
    expect(svc.can('platform.admin')).toBe(true);
    expect(svc.can('space.create')).toBe(true);
    expect(svc.can('space.manage', SPACE_A)).toBe(false);
    expect(svc.can('audit.view', SPACE_A)).toBe(false);
  });

  it('usuário anônimo não pode nada', () => {
    const svc = setup(null, null);
    expect(svc.can('space.view')).toBe(false);
    expect(svc.can('platform.admin')).toBe(false);
  });
});
