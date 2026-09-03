import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';
import { permissionGuard } from './core/authorization/permission.guard';
import { AuthLayoutComponent } from './shared/layout/auth-layout.component';

export const routes: Routes = [
  // ---- Públicas (auth) ----
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'recuperar-senha',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/forgot-password.component').then((m) => m.ForgotPasswordComponent),
  },
  {
    path: 'redefinir-senha',
    loadComponent: () =>
      import('./features/auth/reset-password.component').then((m) => m.ResetPasswordComponent),
  },

  // ---- Autenticadas (shell com sidebar/header) ----
  {
    path: '',
    component: AuthLayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'processos',
        canActivate: [permissionGuard('space.view')],
        loadComponent: () =>
          import('./features/processes/process-list.component').then((m) => m.ProcessListComponent),
      },
      {
        path: 'processos/novo',
        canActivate: [permissionGuard('space.view')],
        loadComponent: () =>
          import('./features/processes/process-form.component').then((m) => m.ProcessFormComponent),
      },
      {
        path: 'processos/:id',
        canActivate: [permissionGuard('space.view')],
        loadComponent: () =>
          import('./features/processes/process-detail.component').then((m) => m.ProcessDetailComponent),
      },
      {
        path: 'clientes',
        canActivate: [permissionGuard('space.view')],
        loadComponent: () =>
          import('./features/clients/client-list.component').then((m) => m.ClientListComponent),
      },
      {
        path: 'clientes/novo',
        canActivate: [permissionGuard('space.view')],
        loadComponent: () =>
          import('./features/clients/client-form.component').then((m) => m.ClientFormComponent),
      },
      {
        path: 'clientes/:id',
        canActivate: [permissionGuard('space.view')],
        loadComponent: () =>
          import('./features/clients/client-detail.component').then((m) => m.ClientDetailComponent),
      },
      {
        path: 'clientes/:id/editar',
        canActivate: [permissionGuard('space.view')],
        loadComponent: () =>
          import('./features/clients/client-form.component').then((m) => m.ClientFormComponent),
      },
      {
        // Catálogo global: visível a qualquer autenticado (SUPER_ADMIN gerencia).
        path: 'tribunais',
        loadComponent: () =>
          import('./features/courts/court-list.component').then((m) => m.CourtListComponent),
      },
      {
        path: 'configuracoes/regras',
        canActivate: [permissionGuard('space.manage')],
        data: { title: 'Regras de notificação', note: 'Fase de Notificações.' },
        loadComponent: () =>
          import('./features/placeholder/placeholder.component').then(
            (m) => m.PlaceholderComponent,
          ),
      },
      {
        path: 'configuracoes/templates',
        canActivate: [permissionGuard('space.manage')],
        data: { title: 'Templates de mensagem', note: 'Fase de Notificações.' },
        loadComponent: () =>
          import('./features/placeholder/placeholder.component').then(
            (m) => m.PlaceholderComponent,
          ),
      },
      {
        path: 'configuracoes/whatsapp',
        canActivate: [permissionGuard('space.manage')],
        data: { title: 'Integração WhatsApp', note: 'Fase WAHA. Apenas ADMIN.' },
        loadComponent: () =>
          import('./features/placeholder/placeholder.component').then(
            (m) => m.PlaceholderComponent,
          ),
      },
      {
        path: 'configuracoes/usuarios',
        canActivate: [permissionGuard('member.view')],
        data: { title: 'Usuários do espaço', note: 'Gestão de membros — fase de Multi-tenancy.' },
        loadComponent: () =>
          import('./features/placeholder/placeholder.component').then(
            (m) => m.PlaceholderComponent,
          ),
      },
      {
        path: 'auditoria',
        canActivate: [permissionGuard('audit.view')],
        data: { title: 'Auditoria', note: 'Consulta da trilha — fase de Auditoria.' },
        loadComponent: () =>
          import('./features/placeholder/placeholder.component').then(
            (m) => m.PlaceholderComponent,
          ),
      },
      {
        path: 'admin',
        canActivate: [permissionGuard('platform.admin')],
        data: { title: 'Administração da plataforma', note: 'Área do SUPER_ADMIN.' },
        loadComponent: () =>
          import('./features/placeholder/placeholder.component').then(
            (m) => m.PlaceholderComponent,
          ),
      },
      {
        path: 'forbidden',
        loadComponent: () =>
          import('./features/status/forbidden.component').then((m) => m.ForbiddenComponent),
      },
    ],
  },

  {
    path: '**',
    loadComponent: () =>
      import('./features/status/not-found.component').then((m) => m.NotFoundComponent),
  },
];
