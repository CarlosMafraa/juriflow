import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { isValidClientDocument } from '@juriflow/domain';
import type { ClientType } from '@juriflow/shared-types';
import { ClientService } from './client.service';
import { ToastService } from '../../shared/feedback/toast.service';
import { AlertComponent } from '../../shared/ui/alert.component';
import { ButtonComponent } from '../../shared/ui/button.component';
import { CardComponent } from '../../shared/ui/card.component';
import { InputComponent } from '../../shared/ui/input.component';

@Component({
  selector: 'jf-client-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, AlertComponent, ButtonComponent, CardComponent, InputComponent],
  template: `
    <header class="head"><h1>{{ id() ? 'Editar cliente' : 'Novo cliente' }}</h1></header>
    <jf-card>
      <form [formGroup]="form" (ngSubmit)="submit()" class="form">
        @if (error()) {
          <jf-alert tone="danger">{{ error() }}</jf-alert>
        }

        <label class="type">
          <span class="lbl">Tipo</span>
          <select formControlName="type">
            <option value="PF">Pessoa física</option>
            <option value="PJ">Pessoa jurídica</option>
          </select>
        </label>

        <jf-input
          [label]="form.value.type === 'PJ' ? 'Razão social' : 'Nome'"
          formControlName="name"
          [required]="true"
          [error]="showError('name') ? 'Informe o nome.' : ''"
        />
        <jf-input
          [label]="form.value.type === 'PJ' ? 'CNPJ' : 'CPF'"
          formControlName="document"
          hint="Opcional. Único no espaço quando informado."
          [error]="docError()"
        />
        <jf-input label="Telefone" type="tel" formControlName="phone" hint="Formato E.164, ex.: +5592999999999" [error]="phoneError()" />
        <jf-input label="E-mail" type="email" formControlName="email" />
        @if (form.value.type === 'PF') {
          <jf-input label="Data de nascimento" type="date" formControlName="birthDate" />
        }

        <label class="chk">
          <input type="checkbox" formControlName="notificationOptIn" />
          <span>Cliente consente em receber notificações por WhatsApp</span>
        </label>

        <div class="actions">
          <jf-button type="button" variant="secondary" (click)="cancel()">Cancelar</jf-button>
          <jf-button type="submit" [loading]="saving()">Salvar</jf-button>
        </div>
      </form>
    </jf-card>
  `,
  styles: [
    `
      .head h1 {
        margin: 0 0 1rem;
        font-size: 1.35rem;
      }
      .form {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        max-width: 32rem;
      }
      .type,
      .lbl {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        font-size: 0.8125rem;
        font-weight: 600;
      }
      select {
        font: inherit;
        padding: 0.55rem 0.75rem;
        border: 1px solid var(--jf-border, #cbd5e1);
        border-radius: var(--jf-radius, 8px);
      }
      .chk {
        display: flex;
        gap: 0.5rem;
        align-items: flex-start;
        font-size: 0.875rem;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
      }
    `,
  ],
})
export class ClientFormComponent {
  readonly id = input<string | undefined>(undefined);

  private readonly fb = inject(FormBuilder);
  private readonly service = inject(ClientService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly saving = signal(false);
  protected readonly error = signal('');

  protected readonly form = this.fb.nonNullable.group({
    type: 'PF' as ClientType,
    name: ['', [Validators.required]],
    document: '',
    phone: '',
    email: ['', [Validators.email]],
    birthDate: '',
    notificationOptIn: false,
  });

  constructor() {
    queueMicrotask(() => void this.maybeLoad());
  }

  private async maybeLoad(): Promise<void> {
    const id = this.id();
    if (!id) return;
    try {
      const c = await this.service.getById(id);
      if (!c) {
        this.error.set('Cliente não encontrado.');
        return;
      }
      this.form.patchValue({
        type: c.type,
        name: c.name,
        document: c.document ?? '',
        phone: c.phone ?? '',
        email: c.email ?? '',
        birthDate: c.birthDate ?? '',
        notificationOptIn: c.notificationOptIn,
      });
    } catch {
      this.error.set('Não foi possível carregar o cliente.');
    }
  }

  protected showError(name: 'name'): boolean {
    const c = this.form.controls[name];
    return c.touched && c.invalid;
  }

  protected docError(): string {
    const v = this.form.getRawValue();
    if (!v.document.trim()) return '';
    return isValidClientDocument(v.type, v.document) ? '' : `${v.type === 'PJ' ? 'CNPJ' : 'CPF'} inválido.`;
  }

  protected phoneError(): string {
    const p = this.form.value.phone?.trim();
    if (!p) return '';
    return /^\+[1-9]\d{6,14}$/.test(p) ? '' : 'Use o formato E.164 (ex.: +5592999999999).';
  }

  protected cancel(): void {
    const id = this.id();
    void this.router.navigate(id ? ['/clientes', id] : ['/clientes']);
  }

  protected async submit(): Promise<void> {
    this.error.set('');
    if (this.form.invalid || this.docError() || this.phoneError()) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    try {
      const v = this.form.getRawValue();
      const input = {
        type: v.type,
        name: v.name,
        document: v.document,
        phone: v.phone,
        email: v.email,
        birthDate: v.birthDate,
        notificationOptIn: v.notificationOptIn,
      };
      const id = this.id();
      if (id) {
        await this.service.update(id, input);
        this.toast.success('Cliente atualizado.');
        await this.router.navigate(['/clientes', id]);
      } else {
        const created = await this.service.create(input);
        this.toast.success('Cliente cadastrado.');
        await this.router.navigate(['/clientes', created.id]);
      }
    } catch (err) {
      this.error.set(this.humanize(err));
    } finally {
      this.saving.set(false);
    }
  }

  private humanize(err: unknown): string {
    const msg = (err as { message?: string })?.message ?? '';
    if (msg.includes('clients_document_uniq')) return 'Já existe um cliente com esse documento neste espaço.';
    if (msg.includes('clients_document_len_chk')) return 'O documento não tem o comprimento esperado (CPF 11, CNPJ 14 dígitos).';
    if (msg.includes('clients_birth_date_pf_chk')) return 'Data de nascimento só é permitida para pessoa física.';
    return 'Não foi possível salvar o cliente.';
  }
}
