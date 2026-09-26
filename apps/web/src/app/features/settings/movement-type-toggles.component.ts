import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TagModule } from 'primeng/tag';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { ToastService } from '../../shared/feedback/toast.service';
import { DialogService } from '../../shared/ui/dialog.service';
import { MovementTypeService, type MovementTypeToggles } from './movement-type.service';

type Audience = 'responsible' | 'client';

/**
 * Lista de tipos de movimentação com um toggle por público (responsáveis /
 * clientes). Sem `processId`: edita o padrão do escritório. Com `processId`:
 * personaliza o processo (o que não for mexido segue o padrão). Cada toggle
 * salva na hora.
 */
@Component({
  selector: 'jf-movement-type-toggles',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ButtonModule,
    InputTextModule,
    ProgressSpinnerModule,
    TagModule,
    ToggleSwitchModule,
  ],
  template: `
    @if (loading()) {
      <div class="center"><p-progressSpinner styleClass="spinner-sm" /></div>
    } @else {
      <div class="toolbar">
        <input
          pInputText
          type="search"
          class="search"
          placeholder="Buscar tipo de movimentação…"
          aria-label="Buscar tipo de movimentação"
          [ngModel]="query()"
          (ngModelChange)="query.set($event)"
        />
        @if (processId() && customizedCount() > 0) {
          <p-button
            size="small"
            severity="secondary"
            [text]="true"
            icon="pi pi-undo"
            label="Voltar ao padrão do escritório"
            (onClick)="reset()"
          />
        }
      </div>

      <div class="table" role="table" aria-label="Tipos de movimentação avisados">
        <div class="head" role="row">
          <span role="columnheader">Tipo de movimentação</span>
          <span role="columnheader" class="c">Responsáveis</span>
          <span role="columnheader" class="c">Clientes</span>
        </div>
        @for (t of filtered(); track t.name) {
          <div class="row" role="row" [attr.data-type]="t.name">
            <span role="cell" class="name">
              {{ t.name }}
              @if (t.customized) {
                <p-tag value="Personalizado" severity="info" styleClass="tag-sm" />
              }
            </span>
            <span role="cell" class="c">
              <p-toggleswitch
                [ngModel]="t.responsible"
                (ngModelChange)="toggle(t, 'responsible', $event)"
                [disabled]="saving() === t.name"
                [ariaLabel]="'Avisar responsáveis: ' + t.name"
              />
            </span>
            <span role="cell" class="c">
              <p-toggleswitch
                [ngModel]="t.client"
                (ngModelChange)="toggle(t, 'client', $event)"
                [disabled]="saving() === t.name"
                [ariaLabel]="'Avisar clientes: ' + t.name"
              />
            </span>
          </div>
        } @empty {
          <p class="muted empty">Nenhum tipo encontrado.</p>
        }
      </div>
      <p class="muted small">
        Tipos novos que aparecerem na consulta do tribunal entram nesta lista já ligados.
      </p>
    }
  `,
  styles: [
    `
      .center {
        display: flex;
        justify-content: center;
        padding: 2rem;
      }
      :host ::ng-deep .spinner-sm {
        width: 2.5rem;
        height: 2.5rem;
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 0.75rem;
      }
      .search {
        flex: 1;
        min-width: 14rem;
        max-width: 28rem;
      }
      .table {
        border: 1px solid var(--jf-border, #e2e8f0);
        border-radius: var(--jf-radius, 8px);
        max-height: 28rem;
        overflow-y: auto;
      }
      .head,
      .row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 7rem 7rem;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
      }
      .head {
        position: sticky;
        top: 0;
        background: var(--jf-surface-muted, #f1f5f9);
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.02em;
        color: var(--jf-text-muted, #64748b);
        z-index: 1;
      }
      .row + .row,
      .head + .row {
        border-top: 1px solid var(--jf-border, #e2e8f0);
      }
      .name {
        font-size: 0.875rem;
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
        overflow-wrap: anywhere;
      }
      .c {
        display: flex;
        justify-content: center;
      }
      :host ::ng-deep .tag-sm {
        font-size: 0.6875rem;
        padding: 0.1rem 0.4rem;
      }
      .empty {
        padding: 1rem;
      }
      .small {
        font-size: 0.75rem;
        margin: 0.5rem 0 0;
      }
      @media (max-width: 36rem) {
        .head,
        .row {
          grid-template-columns: minmax(0, 1fr) 4.5rem 4.5rem;
        }
      }
    `,
  ],
})
export class MovementTypeTogglesComponent {
  private readonly service = inject(MovementTypeService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);

  /** Ausente = padrão do escritório; presente = personalização deste processo. */
  readonly processId = input<string | null>(null);

  protected readonly loading = signal(true);
  protected readonly saving = signal<string | null>(null);
  protected readonly query = signal('');
  protected readonly types = signal<MovementTypeToggles[]>([]);

  protected readonly filtered = computed(() => {
    const q = normalize(this.query());
    return q ? this.types().filter((t) => normalize(t.name).includes(q)) : this.types();
  });
  protected readonly customizedCount = computed(
    () => this.types().filter((t) => t.customized).length,
  );

  constructor() {
    effect(() => {
      const processId = this.processId();
      untracked(() => void this.load(processId));
    });
  }

  private async load(processId: string | null): Promise<void> {
    this.loading.set(true);
    try {
      this.types.set(
        processId
          ? await this.service.listForProcess(processId)
          : await this.service.listForSpace(),
      );
    } catch {
      this.toast.error('Não foi possível carregar os tipos de movimentação.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async toggle(t: MovementTypeToggles, audience: Audience, value: boolean): Promise<void> {
    const next = { ...t, [audience]: value, customized: this.processId() ? true : t.customized };
    this.replace(next);
    this.saving.set(t.name);
    try {
      const processId = this.processId();
      if (processId) {
        await this.service.setForProcess(processId, t.name, next.responsible, next.client);
      } else {
        await this.service.setForSpace(t.name, next.responsible, next.client);
      }
    } catch {
      this.replace(t);
      this.toast.error('Não foi possível salvar. Tente de novo.');
    } finally {
      this.saving.set(null);
    }
  }

  protected async reset(): Promise<void> {
    const processId = this.processId();
    if (!processId) return;
    const ok = await this.dialog.confirm({
      title: 'Voltar ao padrão do escritório',
      message: 'Este processo deixa de ter tipos personalizados e passa a seguir o padrão do escritório.',
      confirmLabel: 'Voltar ao padrão',
    });
    if (!ok) return;
    try {
      await this.service.resetProcess(processId);
      await this.load(processId);
      this.toast.success('Processo voltou ao padrão do escritório.');
    } catch {
      this.toast.error('Não foi possível voltar ao padrão.');
    }
  }

  private replace(t: MovementTypeToggles): void {
    this.types.update((list) => list.map((x) => (x.name === t.name ? t : x)));
  }
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
