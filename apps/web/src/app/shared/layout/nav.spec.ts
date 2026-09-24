import type { Permission } from '@juriflow/domain';
import { NAV_ITEMS, visibleNavItems } from './nav';

describe('visibleNavItems', () => {
  it('COLABORADOR vê itens operacionais, mas não administração/WhatsApp/auditoria', () => {
    const colaboradorCan = (p: Permission): boolean => p === 'space.view';
    const labels = visibleNavItems(colaboradorCan).map((i) => i.label);

    expect(labels).toContain('Dashboard');
    expect(labels).toContain('Processos');
    expect(labels).toContain('Tribunais');
    expect(labels).not.toContain('WhatsApp');
    expect(labels).not.toContain('Auditoria');
    expect(labels).not.toContain('Administração');
    expect(labels).not.toContain('Regras de notificação');
  });

  it('ADMIN vê itens do espaço, mas não a Administração da plataforma', () => {
    const adminCan = (p: Permission): boolean =>
      ['space.view', 'space.manage', 'member.view', 'audit.view'].includes(p);
    const labels = visibleNavItems(adminCan).map((i) => i.label);

    expect(labels).toContain('WhatsApp');
    expect(labels).toContain('Usuários');
    expect(labels).toContain('Auditoria');
    expect(labels).not.toContain('Administração');
  });

  it('SUPER_ADMIN vê a Administração da plataforma', () => {
    const superCan = (p: Permission): boolean => ['platform.admin', 'space.view'].includes(p);
    const labels = visibleNavItems(superCan).map((i) => i.label);
    expect(labels).toContain('Administração');
    expect(labels).not.toContain('WhatsApp');
  });

  it('itens sem permissão (Dashboard, Tribunais) aparecem sempre', () => {
    const denyAll = (): boolean => false;
    expect(visibleNavItems(denyAll, NAV_ITEMS).map((i) => i.label)).toEqual([
      'Dashboard',
      'Tribunais',
    ]);
  });
});
