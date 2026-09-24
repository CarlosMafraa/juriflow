import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { isValidClientDocument } from '@juriflow/domain';
import type { ClientType } from '@juriflow/shared-types';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { ClientService } from './client.service';
import { ToastService } from '../../shared/feedback/toast.service';

@Component({
  selector: 'jf-client-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    CardModule,
    CheckboxModule,
    InputTextModule,
    MessageModule,
    SelectModule,
  ],
  template: `
    <header class="head"><h1>{{ id() ? 'Editar cliente' : 'Novo cliente' }}</h1></header>
    <p-card>
      <form [formGroup]="form" (ngSubmit)="submit()" class="form">
        @if (error()) {
          <p-message severity="error" [text]="error()" styleClass="w-full" />
        }

        <div class="field">
          <label for="type">Tipo</label>
          <p-select inputId="type" [options]="typeOptions" formControlName="type" />
        </div>

        <div class="field">
          <label for="name">{{ form.value.type === 'PJ' ? 'Razão social' : 'Nome' }}</label>
          <input pInputText id="name" formControlName="name" />
          @if (showError('name')) {
            <small class="field__error">Informe o nome.</small>
          }
        </div>
        <div class="field">
          <label for="document">{{ form.value.type === 'PJ' ? 'CNPJ' : 'CPF' }}</label>
          <input pInputText id="document" formControlName="document" />
          @if (docError()) {
            <small class="field__error">{{ docError() }}</small>
          } @else {
            <small class="field__hint">Opcional. Único no espaço quando informado.</small>
          }
        </div>
        <div class="field">
          <label for="phone">Telefone</label>
          <input pInputText id="phone" type="tel" formControlName="phone" />
          @if (phoneError()) {
            <small class="field__error">{{ phoneError() }}</small>
          } @else {
            <small class="field__hint">Formato E.164, ex.: +5592999999999</small>
          }
        </div>
        <div class="field">
          <label for="email">E-mail</label>
          <input pInputText id="email" type="email" formControlName="email" />
        </div>
        @if (form.value.type === 'PF') {
          <div class="field">
            <label for="birthDate">Data de nascimento</label>
            <input pInputText id="birthDate" type="date" formControlName="birthDate" />
          </div>
        }

        <label class="chk" for="notificationOptIn">
          <p-checkbox inputId="notificationOptIn" [binary]="true" formControlName="notificationOptIn" />
          <span>Cliente consente em receber notificações por WhatsApp</span>
        </label>

        <div class="actions">
          <p-button type="button" severity="secondary" [outlined]="true" icon="pi pi-times" label="Cancelar" (onClick)="cancel()" />
          <p-button type="submit" icon="pi pi-check" label="Salvar" [loading]="saving()" />
        </div>
      </form>
    </p-card>
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
      :host ::ng-deep .w-full {
        width: 100%;
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

  protected readonly typeOptions = [
    { label: 'Pessoa física', value: 'PF' },
    { label: 'Pessoa jurídica', value: 'PJ' },
  ];

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
