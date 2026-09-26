import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';
import { permissionGuard, usersAreaGuard } from './core/authorization/permission.guard';
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

  // ---- Públicas (LGPD) — acessíveis logado ou não ----
  {
    path: 'privacidade',
    data: { kind: 'privacy' },
    title: 'Política de Privacidade — JuriFlow',
    loadComponent: () =>
      import('./features/legal/legal-page.component').then((m) => m.LegalPageComponent),
  },
  {
    path: 'termos',
    data: { kind: 'terms' },
    title: 'Termos de Uso — JuriFlow',
    loadComponent: () =>
      import('./features/legal/legal-page.component').then((m) => m.LegalPageComponent),
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
          import('./features/processes/process-detail.component').then(
            (m) => m.ProcessDetailComponent,
          ),
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
        // Sem permissionGuard: qualquer usuário autenticado edita o próprio perfil.
        path: 'perfil',
        loadComponent: () =>
          import('./features/profile/profile.component').then((m) => m.ProfileComponent),
      },
      {
        path: 'configuracoes/espaco',
        canActivate: [permissionGuard('space.manage')],
        loadComponent: () =>
          import('./features/settings/space-settings.component').then(
            (m) => m.SpaceSettingsComponent,
          ),
      },
      {
        path: 'configuracoes/regras',
        canActivate: [permissionGuard('space.manage')],
        loadComponent: () =>
          import('./features/settings/notification-settings.component').then(
            (m) => m.NotificationSettingsComponent,
          ),
      },
      {
        path: 'configuracoes/templates',
        canActivate: [permissionGuard('space.manage')],
        loadComponent: () =>
          import('./features/settings/template-list.component').then(
            (m) => m.TemplateListComponent,
          ),
      },
      {
        path: 'configuracoes/whatsapp',
        canActivate: [permissionGuard('space.manage')],
        loadComponent: () =>
          import('./features/settings/whatsapp-settings.component').then(
            (m) => m.WhatsappSettingsComponent,
          ),
      },
      {
        // Só ADMIN — exceto quem ainda não tem espaço, que aceita convites aqui.
        path: 'configuracoes/usuarios',
        canActivate: [usersAreaGuard],
        loadComponent: () =>
          import('./features/team/team-list.component').then((m) => m.TeamListComponent),
      },
      {
        path: 'auditoria',
        canActivate: [permissionGuard('audit.view')],
        loadComponent: () =>
          import('./features/audit/audit-list.component').then((m) => m.AuditListComponent),
      },
      {
        path: 'admin',
        canActivate: [permissionGuard('platform.admin')],
        loadComponent: () =>
          import('./features/admin/admin.component').then((m) => m.AdminComponent),
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
