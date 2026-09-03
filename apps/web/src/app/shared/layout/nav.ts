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
  { label: 'Dashboard', path: '/', icon: '▤', exact: true },
  { label: 'Processos', path: '/processos', icon: '⚖', permission: 'space.view' },
  { label: 'Clientes', path: '/clientes', icon: '🧑', permission: 'space.view' },
  { label: 'Tribunais', path: '/tribunais', icon: '🏛' },
  {
    label: 'Regras de notificação',
    path: '/configuracoes/regras',
    icon: '🔔',
    permission: 'space.manage',
  },
  { label: 'Templates', path: '/configuracoes/templates', icon: '✉', permission: 'space.manage' },
  { label: 'WhatsApp', path: '/configuracoes/whatsapp', icon: '💬', permission: 'space.manage' },
  { label: 'Usuários', path: '/configuracoes/usuarios', icon: '👥', permission: 'member.view' },
  { label: 'Auditoria', path: '/auditoria', icon: '🗂', permission: 'audit.view' },
  { label: 'Administração', path: '/admin', icon: '🛠', permission: 'platform.admin' },
];

export function visibleNavItems(
  can: (permission: Permission) => boolean,
  items: readonly NavItem[] = NAV_ITEMS,
): NavItem[] {
  return items.filter((item) => !item.permission || can(item.permission));
}
