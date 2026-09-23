import type { Permission } from '@juriflow/domain';

export interface NavItem {
  label: string;
  path: string;
  icon: string;
  /** Permissão exigida para o item aparecer. Ausente = sempre visível (autenticado). */
  permission?: Permission;
  exact?: boolean;
}

/**
 * Navegação principal. A visibilidade é filtrada por permissão, mas isso é só
 * UX — cada rota também tem guard e cada tela depende de RLS/API (ADR-0003).
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Dashboard', path: '/', icon: 'pi pi-home', exact: true },
  { label: 'Processos', path: '/processos', icon: 'pi pi-briefcase', permission: 'space.view' },
  { label: 'Clientes', path: '/clientes', icon: 'pi pi-users', permission: 'space.view' },
  { label: 'Tribunais', path: '/tribunais', icon: 'pi pi-building' },
  { label: 'Meu perfil', path: '/perfil', icon: 'pi pi-user' },
  {
    label: 'Regras de notificação',
    path: '/configuracoes/regras',
    icon: 'pi pi-bell',
    permission: 'space.manage',
  },
  {
    label: 'Templates',
    path: '/configuracoes/templates',
    icon: 'pi pi-envelope',
    permission: 'space.manage',
  },
  {
    label: 'WhatsApp',
    path: '/configuracoes/whatsapp',
    icon: 'pi pi-whatsapp',
    permission: 'space.manage',
  },
  { label: 'Usuários', path: '/configuracoes/usuarios', icon: 'pi pi-id-card', permission: 'member.view' },
  { label: 'Auditoria', path: '/auditoria', icon: 'pi pi-history', permission: 'audit.view' },
  { label: 'Administração', path: '/admin', icon: 'pi pi-cog', permission: 'platform.admin' },
];

export function visibleNavItems(
  can: (permission: Permission) => boolean,
  items: readonly NavItem[] = NAV_ITEMS,
): NavItem[] {
  return items.filter((item) => !item.permission || can(item.permission));
}
