import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../shared/feedback/toast.service';
import { SpaceSettingsService } from './space-settings.service';

@Component({
  selector: 'jf-space-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ButtonModule, CardModule, InputTextModule, ProgressSpinnerModule],
  template: `
    <header class="head"><h1>Dados do espaço</h1></header>
    <p class="hint">Nome do espaço, visível no topo da tela.</p>

    @if (loading()) {
      <div class="center"><p-progressSpinner styleClass="spinner-sm" /></div>
    } @else {
      <p-card>
        <div class="field">
          <label for="space-name">Nome</label>
          <input pInputText id="space-name" [ngModel]="name()" (ngModelChange)="name.set($event)" />
        </div>

        <div class="actions">
          <p-button icon="pi pi-check" (onClick)="save()" [loading]="saving()" label="Salvar" />
        </div>
      </p-card>
    }
  `,
  styles: [
    `
      .head h1 {
        margin: 0 0 0.35rem;
        font-size: 1.35rem;
      }
      .hint {
        margin: 0 0 1rem;
        font-size: 0.8125rem;
        color: var(--jf-text-muted, #64748b);
        max-width: 34rem;
      }
      .center {
        display: flex;
        justify-content: center;
        padding: 2.5rem;
      }
      :host ::ng-deep .spinner-sm {
        width: 2.5rem;
        height: 2.5rem;
      }
      .field {
        display: grid;
        gap: 0.35rem;
        max-width: 24rem;
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

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly name = signal('');

  constructor() {
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
