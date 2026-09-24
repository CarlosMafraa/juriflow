import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import type { Profile, Space } from '@juriflow/shared-types';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../shared/feedback/toast.service';
import { DialogService } from '../../shared/ui/dialog.service';
import { PlatformAdminService } from './platform-admin.service';
import { PageHeaderService } from '../../shared/layout/page-header.service';

@Component({
  selector: 'jf-admin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    CardModule,
    InputTextModule,
    ProgressSpinnerModule,
    SelectModule,
    TableModule,
    TagModule,
  ],
  template: `
    @if (loading()) {
      <div class="center"><p-progressSpinner styleClass="spinner-sm" /></div>
    } @else {
      <p-card header="Espaços" styleClass="section">
        <form class="create-form" [formGroup]="spaceForm" (ngSubmit)="createSpace()">
          <input pInputText class="f" placeholder="Nome do espaço" formControlName="name" />
          <p-select
            class="f"
            [options]="profileOptions()"
            formControlName="adminProfileId"
            placeholder="Administrador inicial"
          />
          <p-button type="submit" size="small" icon="pi pi-plus" [loading]="creatingSpace()" label="Criar espaço" />
        </form>

        <p-table [value]="spaces()" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th>Nome</th>
              <th>Slug</th>
              <th>Status</th>
              <th></th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-s>
            <tr>
              <td>{{ s.name }}</td>
              <td>{{ s.slug }}</td>
              <td><p-tag [severity]="s.status === 'active' ? 'success' : 'danger'" [value]="s.status" /></td>
              <td class="actions">
                <p-button
                  size="small"
                  severity="secondary"
                  [outlined]="true"
                  [icon]="s.status === 'active' ? 'pi pi-ban' : 'pi pi-refresh'"
                  [label]="s.status === 'active' ? 'Suspender' : 'Reativar'"
                  (onClick)="toggleSpaceStatus(s)"
                />
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="4">Nenhum espaço cadastrado ainda.</td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>

      <p-card header="Usuários" styleClass="section">
        <p-table [value]="profiles()" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th>Nome</th>
              <th>E-mail</th>
              <th>Plataforma</th>
              <th></th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-p>
            <tr>
              <td>{{ p.fullName || '—' }}</td>
              <td>{{ p.email }}</td>
              <td>
                @if (p.isSuperAdmin) {
                  <p-tag severity="info" value="SUPER_ADMIN" />
                } @else {
                  <span class="muted">—</span>
                }
              </td>
              <td class="actions">
                <p-button
                  size="small"
                  severity="secondary"
                  [outlined]="true"
                  [disabled]="p.id === currentUserId()"
                  [icon]="p.isSuperAdmin ? 'pi pi-user-minus' : 'pi pi-shield'"
                  [label]="p.isSuperAdmin ? 'Remover SUPER_ADMIN' : 'Tornar SUPER_ADMIN'"
                  (onClick)="toggleSuperAdmin(p)"
                />
              </td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>
    }
  `,
  styles: [
    `
      .center {
        display: flex;
        justify-content: center;
        padding: 2.5rem;
      }
      :host ::ng-deep .spinner-sm {
        width: 2.5rem;
        height: 2.5rem;
      }
      /* styleClass do p-card cai num div interno do template do PrimeNG, fora
         do encapsulamento deste componente — precisa de ::ng-deep, senão a
         regra nunca é aplicada. */
      :host ::ng-deep .section {
        display: block;
        margin-bottom: 1rem;
      }
      .create-form {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
        margin-bottom: 1rem;
      }
      .f {
        min-width: 12rem;
        flex: 1 1 12rem;
      }
      .actions {
        text-align: right;
      }
      .muted {
        color: var(--jf-text-muted, #64748b);
      }
    `,
  ],
})
export class AdminComponent {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(PlatformAdminService);
  private readonly toast = inject(ToastService);
  private readonly dialogs = inject(DialogService);
  private readonly auth = inject(AuthService);
  private readonly pageHeader = inject(PageHeaderService);

  protected readonly currentUserId = this.auth.userId;
  protected readonly loading = signal(true);
  protected readonly creatingSpace = signal(false);
  protected readonly spaces = signal<Space[]>([]);
  protected readonly profiles = signal<Profile[]>([]);
  protected readonly profileOptions = signal<{ label: string; value: string }[]>([]);

  protected readonly spaceForm = this.fb.nonNullable.group({
    name: '',
    adminProfileId: '',
  });

  constructor() {
    this.pageHeader.set(
      'Administração da plataforma',
      'Área do SUPER_ADMIN — opera espaços e usuários da plataforma, sem acesso ao conteúdo operacional de cada espaço.',
    );
    void this.load();
  }

  protected async createSpace(): Promise<void> {
    const { name, adminProfileId } = this.spaceForm.getRawValue();
    if (!name.trim() || !adminProfileId) {
      this.toast.error('Informe o nome do espaço e escolha o administrador inicial.');
      return;
    }
    this.creatingSpace.set(true);
    try {
      await this.service.createSpace(name, adminProfileId);
      this.toast.success('Espaço criado.');
      this.spaceForm.reset({ name: '', adminProfileId: '' });
      this.spaces.set(await this.service.listSpaces());
    } catch (err) {
      this.toast.error(err instanceof Error ? err.message : 'Não foi possível criar o espaço.');
    } finally {
      this.creatingSpace.set(false);
    }
  }

  protected async toggleSpaceStatus(space: Space): Promise<void> {
    const next = space.status === 'active' ? 'suspended' : 'active';
    if (next === 'suspended') {
      const confirmed = await this.dialogs.confirm({
        title: 'Suspender espaço',
        message: `Ninguém do espaço "${space.name}" vai conseguir acessar o sistema até reativar. Confirma?`,
        confirmLabel: 'Suspender',
        tone: 'danger',
      });
      if (!confirmed) return;
    }
    try {
      await this.service.setSpaceStatus(space.id, next);
      this.toast.success(next === 'suspended' ? 'Espaço suspenso.' : 'Espaço reativado.');
      this.spaces.set(await this.service.listSpaces());
    } catch {
      this.toast.error('Não foi possível atualizar o status do espaço.');
    }
  }

  protected async toggleSuperAdmin(profile: Profile): Promise<void> {
    const next = !profile.isSuperAdmin;
    const confirmed = await this.dialogs.confirm({
      title: next ? 'Conceder SUPER_ADMIN' : 'Remover SUPER_ADMIN',
      message: next
        ? `${profile.fullName || profile.email} passará a operar a plataforma inteira.`
        : `${profile.fullName || profile.email} perderá o acesso de plataforma.`,
      confirmLabel: 'Confirmar',
      tone: next ? 'primary' : 'danger',
    });
    if (!confirmed) return;
    try {
      await this.service.setSuperAdmin(profile.id, next);
      this.toast.success('Acesso de plataforma atualizado.');
      this.profiles.set(await this.service.listProfiles());
    } catch {
      this.toast.error('Não foi possível atualizar o acesso de plataforma.');
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [spaces, profiles] = await Promise.all([
        this.service.listSpaces(),
        this.service.listProfiles(),
      ]);
      this.spaces.set(spaces);
      this.profiles.set(profiles);
      this.profileOptions.set(
        profiles.map((p) => ({ label: p.fullName || p.email, value: p.id })),
      );
    } catch {
      this.toast.error('Não foi possível carregar os dados de administração.');
    } finally {
      this.loading.set(false);
    }
  }
}
