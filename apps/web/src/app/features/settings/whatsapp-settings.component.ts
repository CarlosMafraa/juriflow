import { ChangeDetectionStrategy, Component, OnDestroy, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { WhatsappSession, WhatsappSessionStatus } from '@juriflow/shared-types';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { MessageModule } from 'primeng/message';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TagModule } from 'primeng/tag';
import { ToastService } from '../../shared/feedback/toast.service';
import { WhatsappService } from './whatsapp.service';
import { PageHeaderService } from '../../shared/layout/page-header.service';

const POLL_MS = 2500;

interface StatusView {
  severity: 'success' | 'info' | 'warn' | 'danger' | 'secondary';
  label: string;
}

const STATUS_VIEW: Record<WhatsappSessionStatus, StatusView> = {
  disconnected: { severity: 'secondary', label: 'Desconectado' },
  connecting: { severity: 'info', label: 'Conectando…' },
  qr_ready: { severity: 'warn', label: 'Aguardando leitura do QR code' },
  connected: { severity: 'success', label: 'Conectado' },
  failed: { severity: 'danger', label: 'Falhou' },
};

@Component({
  selector: 'jf-whatsapp-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, ButtonModule, CardModule, MessageModule, ProgressSpinnerModule, TagModule],
  template: `
    @if (loading()) {
      <div class="center"><p-progressSpinner styleClass="spinner-sm" /></div>
    } @else {
      <p-card header="Status da sessão">
        @let s = session();
        <div class="status-row">
          <p-tag [severity]="view(s).severity" [value]="view(s).label" />
          @if (s?.connectedAt) {
            <span class="meta">conectado em {{ s!.connectedAt | date: 'dd/MM/yyyy HH:mm' }}</span>
          }
        </div>

        @if (s?.status === 'failed' && s?.lastError) {
          <p-message severity="error" [text]="s!.lastError!" styleClass="w-full block" />
        }

        @if (s?.status === 'qr_ready' && s?.qrCode) {
          <div class="qr-wrap">
            <img [src]="s!.qrCode" alt="QR code para conectar o WhatsApp" class="qr" />
            <p class="qr-hint">Abra o WhatsApp no celular do espaço → Aparelhos conectados → escaneie este código.</p>
          </div>
        }

        <div class="actions">
          @if (!s || s.status === 'disconnected' || s.status === 'failed') {
            <p-button size="small" icon="pi pi-link" label="Conectar" [loading]="acting()" (onClick)="connect()" />
          } @else {
            <p-button
              size="small"
              icon="pi pi-times-circle"
              label="Desconectar"
              severity="secondary"
              [outlined]="true"
              [loading]="acting()"
              [disabled]="s.pendingAction === 'disconnect'"
              (onClick)="disconnect()"
            />
          }
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
      /* Página de uma seção só — o card é o painel da própria página, sem
         disputar espaço com outros cards ao lado, então vai até o final. */
      .status-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 1rem;
      }
      .meta {
        font-size: 0.8125rem;
        color: var(--jf-text-muted, #64748b);
      }
      .qr-wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        padding: 1rem 0;
      }
      .qr {
        width: 220px;
        height: 220px;
        border: 1px solid var(--jf-border, #e2e8f0);
        border-radius: 0.5rem;
      }
      .qr-hint {
        margin: 0;
        font-size: 0.8125rem;
        color: var(--jf-text-muted, #64748b);
        text-align: center;
        max-width: 24rem;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        padding-top: 1rem;
      }
    `,
  ],
})
export class WhatsappSettingsComponent implements OnDestroy {
  private readonly service = inject(WhatsappService);
  private readonly toast = inject(ToastService);
  private readonly pageHeader = inject(PageHeaderService);

  protected readonly loading = signal(true);
  protected readonly acting = signal(false);
  protected readonly session = signal<WhatsappSession | null>(null);

  private pollHandle: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.pageHeader.set(
      'Integração WhatsApp',
      'Cada espaço conecta seu próprio número, usado para notificações de movimentação.',
    );
    void this.load();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  protected view(s: WhatsappSession | null): StatusView {
    return STATUS_VIEW[s?.status ?? 'disconnected'];
  }

  protected async connect(): Promise<void> {
    this.acting.set(true);
    try {
      this.session.set(await this.service.requestConnect());
      this.toast.info('Conectando… aguarde o QR code aparecer.');
      this.syncPolling();
    } catch {
      this.toast.error('Não foi possível iniciar a conexão do WhatsApp.');
    } finally {
      this.acting.set(false);
    }
  }

  protected async disconnect(): Promise<void> {
    this.acting.set(true);
    try {
      this.session.set(await this.service.requestDisconnect());
      this.toast.info('Desconectando…');
      this.syncPolling();
    } catch {
      this.toast.error('Não foi possível desconectar o WhatsApp.');
    } finally {
      this.acting.set(false);
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.session.set(await this.service.getSession());
      this.syncPolling();
    } catch {
      this.toast.error('Não foi possível carregar o status do WhatsApp.');
    } finally {
      this.loading.set(false);
    }
  }

  private async refresh(): Promise<void> {
    try {
      this.session.set(await this.service.getSession());
    } catch {
      /* silencioso — próximo tick tenta de novo */
    } finally {
      this.syncPolling();
    }
  }

  private syncPolling(): void {
    const s = this.session();
    const transient = s !== null && (s.pendingAction !== null || s.status === 'connecting' || s.status === 'qr_ready');
    if (transient && !this.pollHandle) {
      this.pollHandle = setInterval(() => void this.refresh(), POLL_MS);
    } else if (!transient) {
      this.stopPolling();
    }
  }

  private stopPolling(): void {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }
}
