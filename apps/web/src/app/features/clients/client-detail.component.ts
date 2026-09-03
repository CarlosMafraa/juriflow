import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { Client } from '@juriflow/shared-types';
import { ClientService } from './client.service';
import { ProcessService, type ProcessListRow } from '../processes/process.service';
import { PermissionService } from '../../core/authorization/permission.service';
import { AuthService } from '../../core/auth/auth.service';
import { DialogService } from '../../shared/ui/dialog.service';
import { ToastService } from '../../shared/feedback/toast.service';
import { ButtonComponent } from '../../shared/ui/button.component';
import { CardComponent } from '../../shared/ui/card.component';
import { BadgeComponent } from '../../shared/ui/badge.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';

@Component({
  selector: 'jf-client-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ButtonComponent,
    CardComponent,
    BadgeComponent,
    SpinnerComponent,
    EmptyStateComponent,
  ],
  template: `
    @if (loading()) {
      <div class="center"><jf-spinner [showLabel]="true" /></div>
    } @else if (!client()) {
      <jf-empty-state title="Cliente não encontrado"><span empty-icon>🧭</span></jf-empty-state>
    } @else {
      <header class="head">
        <h1>{{ client()!.name }} <jf-badge>{{ client()!.type }}</jf-badge></h1>
        <div class="acts">
          @if (canEdit()) {
            <a [routerLink]="['/clientes', client()!.id, 'editar']"><jf-button variant="secondary">Editar</jf-button></a>
            <jf-button variant="danger" (click)="remove()">Excluir</jf-button>
          }
        </div>
      </header>

      <jf-card title="Dados">
        <dl class="grid">
          <dt>Documento</dt><dd>{{ client()!.document || '—' }}</dd>
          <dt>Telefone</dt><dd>{{ client()!.phone || '—' }}</dd>
          <dt>E-mail</dt><dd>{{ client()!.email || '—' }}</dd>
          @if (client()!.type === 'PF') {
            <dt>Nascimento</dt><dd>{{ client()!.birthDate || '—' }}</dd>
          }
          <dt>Notificações WhatsApp</dt>
          <dd>{{ client()!.notificationOptIn ? 'Consentido' : 'Não consentido' }}</dd>
        </dl>
      </jf-card>

      <jf-card title="Processos vinculados">
        @if (processes().length === 0) {
          <p class="muted">Nenhum processo vinculado visível para você.</p>
        } @else {
          <ul class="plist">
            @for (p of processes(); track p.id) {
              <li>
                <a [routerLink]="['/processos', p.id]">{{ p.cnjNumber || p.internalRef || p.id }}</a>
                <jf-badge [tone]="p.status === 'active' ? 'success' : 'neutral'">{{ p.status }}</jf-badge>
              </li>
            }
          </ul>
        }
      </jf-card>
    }
  `,
  styles: [
    `
      .center {
        display: flex;
        justify-content: center;
        padding: 2.5rem;
      }
      .head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        flex-wrap: wrap;
        margin-bottom: 1rem;
      }
      .head h1 {
        margin: 0;
        font-size: 1.3rem;
        display: flex;
        align-items: center;
        gap: 0.6rem;
      }
      .acts {
        display: flex;
        gap: 0.5rem;
      }
      .grid {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 0.4rem 1.25rem;
        margin: 0;
      }
      dt {
        color: var(--jf-text-muted, #64748b);
        font-size: 0.85rem;
      }
      dd {
        margin: 0;
      }
      .muted {
        color: var(--jf-text-muted, #64748b);
        margin: 0;
      }
      .plist {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }
      .plist li {
        display: flex;
        gap: 0.6rem;
        align-items: center;
      }
      jf-card {
        display: block;
        margin-bottom: 1rem;
      }
    `,
  ],
})
export class ClientDetailComponent {
  readonly id = input.required<string>();

  private readonly clients = inject(ClientService);
  private readonly processesSvc = inject(ProcessService);
  private readonly permissions = inject(PermissionService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly client = signal<Client | null>(null);
  protected readonly processes = signal<ProcessListRow[]>([]);

  constructor() {
    queueMicrotask(() => void this.load());
  }

  protected canEdit(): boolean {
    const c = this.client();
    if (!c) return false;
    return this.permissions.can('space.manage') || c.createdBy === this.auth.userId();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const c = await this.clients.getById(this.id());
      this.client.set(c);
      if (c) {
        const page = await this.processesSvc.list({ clientId: c.id, pageSize: 50 });
        this.processes.set(page.rows);
      }
    } catch {
      this.toast.error('Não foi possível carregar o cliente.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const c = this.client();
    if (!c) return;
    const ok = await this.dialog.confirm({
      title: 'Excluir cliente',
      message: `"${c.name}" será removido e seus dados pessoais anonimizados. Os vínculos com processos são mantidos. Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await this.clients.softDelete(c.id);
      this.toast.success('Cliente excluído.');
      await this.router.navigate(['/clientes']);
    } catch {
      this.toast.error('Não foi possível excluir o cliente.');
    }
  }
}
