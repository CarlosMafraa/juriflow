import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../shared/feedback/toast.service';
import { SpaceSettingsService } from './space-settings.service';
import { PageHeaderService } from '../../shared/layout/page-header.service';

@Component({
  selector: 'jf-space-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ButtonModule, CardModule, InputTextModule, ProgressSpinnerModule],
  template: `
    @if (loading()) {
      <div class="center"><p-progressSpinner styleClass="spinner-sm" /></div>
    } @else {
      <p-card>
        <div class="field">
          <label for="space-name">Nome</label>
          <input pInputText id="space-name" [ngModel]="name()" (ngModelChange)="name.set($event)" />
        </div>

        <div class="actions">
          <p-button size="small" icon="pi pi-check" (onClick)="save()" [loading]="saving()" label="Salvar" />
        </div>
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
      /* O card do PrimeNG por padrão ocupa 100% do container — sem isso ele
         fica bem mais largo que o campo, com um vão vazio do lado. */
      :host ::ng-deep .p-card {
        max-width: 24rem;
      }
      .field {
        display: grid;
        gap: 0.35rem;
        margin-bottom: 1rem;
      }
      .field label {
        font-size: 0.8125rem;
        font-weight: 600;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        padding-top: 0.5rem;
      }
    `,
  ],
})
export class SpaceSettingsComponent {
  private readonly service = inject(SpaceSettingsService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly pageHeader = inject(PageHeaderService);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly name = signal('');

  constructor() {
    this.pageHeader.set('Dados do espaço', 'Nome do espaço.');
    void this.load();
  }

  protected async save(): Promise<void> {
    if (!this.name().trim()) {
      this.toast.error('Informe o nome do espaço.');
      return;
    }
    this.saving.set(true);
    try {
      await this.service.update({ name: this.name() });
      // Topbar lê de AuthService.memberships(), que não se atualiza sozinho
      // após um update direto na tabela spaces.
      await this.auth.refreshContext();
      this.toast.success('Dados do espaço atualizados.');
    } catch {
      this.toast.error('Não foi possível salvar os dados do espaço.');
    } finally {
      this.saving.set(false);
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const space = await this.service.get();
      this.name.set(space.name);
    } catch {
      this.toast.error('Não foi possível carregar os dados do espaço.');
    } finally {
      this.loading.set(false);
    }
  }
}
