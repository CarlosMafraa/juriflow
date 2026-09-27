import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  DEFAULT_MESSAGE_TEMPLATE,
  type Client,
  type MessageTemplate,
  type ProcessNotificationConfig,
  type SpaceNotificationConfig,
  type WhatsappSessionStatus,
} from '@juriflow/shared-types';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import {
  ProcessService,
  type DeliveryRow,
  type HistoryRow,
  type LinkedClient,
  type MovementRow,
  type ProcessDetail,
} from './process.service';
import { ClientService } from '../clients/client.service';
import { MovementTypeTogglesComponent } from '../settings/movement-type-toggles.component';
import { NotificationConfigService } from '../settings/notification-config.service';
import { TemplateService } from '../settings/template.service';
import { WhatsappService } from '../settings/whatsapp.service';
import {
  WhatsappPreviewComponent,
  renderMessagePreview,
  templateBodyOrDefault,
} from '../settings/whatsapp-preview.component';
import { SpaceMembersService, type SpaceMemberOption } from '../../core/data/space-members.service';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';
import { AuthService } from '../../core/auth/auth.service';
import { PermissionService } from '../../core/authorization/permission.service';
import { DialogService } from '../../shared/ui/dialog.service';
import { ToastService } from '../../shared/feedback/toast.service';
import { PageHeaderActionsDirective } from '../../shared/layout/page-header-actions.directive';
import { PageHeaderService } from '../../shared/layout/page-header.service';

type Tab = 'resumo' | 'movimentacoes' | 'notificacoes' | 'responsaveis' | 'clientes';
const TABS: readonly Tab[] = [
  'resumo',
  'movimentacoes',
  'notificacoes',
  'responsaveis',
  'clientes',
];

function initialTab(requested: string | null): Tab {
  return TABS.includes(requested as Tab) ? (requested as Tab) : 'resumo';
}

const DEFAULT_TEMPLATE_NAME = DEFAULT_MESSAGE_TEMPLATE.name;

/** AAAA-MM-DD no fuso do navegador (valor de <input type="date">). */
function isoDay(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type SavedOverride = Pick<
  ProcessNotificationConfig,
  'notifyResponsible' | 'notifyClients' | 'responsibleTemplateId' | 'clientTemplateId'
>;

@Component({
  selector: 'jf-process-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MovementTypeTogglesComponent,
    ReactiveFormsModule,
    FormsModule,
    RouterLink,
    ButtonModule,
    CardModule,
    CheckboxModule,
    InputTextModule,
    MessageModule,
    ProgressSpinnerModule,
    SelectModule,
    SelectButtonModule,
    TableModule,
    TagModule,
    TextareaModule,
    ToggleSwitchModule,
    PageHeaderActionsDirective,
    WhatsappPreviewComponent,
  ],
  template: `
    <ng-template jfPageHeaderActions>
      @if (process(); as p) {
        @if (canEdit() && p.status === 'active') {
          <p-button
            size="small"
            severity="secondary"
            [outlined]="true"
            icon="pi pi-inbox"
            label="Arquivar"
            (onClick)="setStatus('archived')"
          />
        }
        @if (isAdmin()) {
          @if (p.status === 'archived') {
            <p-button
              size="small"
              severity="secondary"
              [outlined]="true"
              icon="pi pi-refresh"
              label="Reativar"
              (onClick)="setStatus('active')"
            />
            <p-button
              size="small"
              severity="danger"
              icon="pi pi-trash"
              label="Excluir"
              (onClick)="remove()"
            />
          } @else if (p.status === 'closed') {
            <p-button
              size="small"
              severity="secondary"
              [outlined]="true"
              icon="pi pi-lock-open"
              label="Reabrir"
              (onClick)="setStatus('active')"
            />
          } @else {
            <p-button
              size="small"
              severity="secondary"
              [outlined]="true"
              icon="pi pi-lock"
              label="Encerrar"
              (onClick)="setStatus('closed')"
            />
          }
        }
      }
    </ng-template>

    @if (loading()) {
      <div class="center"><p-progressSpinner styleClass="spinner-sm" /></div>
    } @else if (!process()) {
      <p-message severity="warn" styleClass="w-full">
        Processo não encontrado. Ele pode ter sido transferido, arquivado ou você não tem acesso.
      </p-message>
      <a routerLink="/processos"
        ><p-button
          size="small"
          severity="secondary"
          [outlined]="true"
          icon="pi pi-arrow-left"
          label="Voltar"
          styleClass="back-btn"
      /></a>
    } @else {
      @if (msg()) {
        <p-message [severity]="msg()!.tone" [text]="msg()!.text" styleClass="w-full section" />
      }

      <div class="tabs">
        <p-selectButton
          [options]="tabOptions()"
          [ngModel]="tab()"
          (ngModelChange)="selectTab($event)"
          [allowEmpty]="false"
          optionLabel="label"
          optionValue="value"
          aria-label="Seções do processo"
        />
      </div>

      @switch (tab()) {
        @case ('resumo') {
          <p-card header="Dados" styleClass="section">
            <form [formGroup]="coreForm" (ngSubmit)="saveCore()" class="core">
              <div class="field">
                <label for="cnjNumber">Número CNJ</label>
                <input
                  pInputText
                  id="cnjNumber"
                  formControlName="cnjNumber"
                  [readonly]="!canEdit()"
                  placeholder="—"
                />
              </div>
              <div class="field">
                <label for="internalRef">Referência interna</label>
                <input
                  pInputText
                  id="internalRef"
                  formControlName="internalRef"
                  [readonly]="!canEdit()"
                  placeholder="—"
                />
              </div>
              <div class="ro">
                <span>Tribunal</span><strong>{{ process()!.courtName }}</strong>
              </div>
              <div class="ro">
                <span>Responsáveis</span><strong>{{ responsibleNames() }}</strong>
              </div>
              <div class="ro">
                <span>Cadastrado por</span><strong>{{ process()!.creatorName }}</strong>
              </div>
              @if (canEdit()) {
                <div class="core-actions field--full">
                  <p-button
                    type="submit"
                    size="small"
                    icon="pi pi-check"
                    label="Salvar dados"
                    [loading]="savingCore()"
                  />
                </div>
              }
            </form>
          </p-card>

          <p-card header="Acompanhamento" styleClass="section">
            <div class="tracking">
              <div class="tracking__info">
                @if (process()!.checkRequestedAt) {
                  <p-tag severity="info" icon="pi pi-spin pi-spinner" value="Consulta na fila" />
                  <span class="muted small"
                    >O resultado aparece aqui assim que a coleta terminar.</span
                  >
                } @else if (process()!.lastCheckedAt) {
                  <span
                    >Última consulta: <strong>{{ fmt(process()!.lastCheckedAt!) }}</strong></span
                  >
                } @else {
                  <span class="muted">Ainda não consultado.</span>
                }
              </div>
              <p-button
                size="small"
                icon="pi pi-sync"
                label="Consultar agora"
                [disabled]="!!checkBlockedReason() || !!process()!.checkRequestedAt"
                [loading]="requestingCheck()"
                (onClick)="requestCheck()"
              />
            </div>
            @if (checkBlockedReason()) {
              <p class="muted small">{{ checkBlockedReason() }}</p>
            }
            <div class="sync">
              <p-toggleswitch
                inputId="trackingEnabled"
                [ngModel]="process()!.trackingEnabled"
                (ngModelChange)="setTracking($event)"
                [disabled]="!canEdit() || savingTracking()"
              />
              <label for="trackingEnabled">
                Sincronização automática
                <small class="muted"
                  >— desligada por padrão. Ligue só nos processos que o escritório quer acompanhar
                  (a coleta diária e os avisos seguem o limite do plano).</small
                >
              </label>
            </div>
            @if (process()!.trackingEnabled && process()!.syncBaselinePending) {
              <p-message severity="info" styleClass="w-full tracking__error">
                Este processo tinha movimentações cadastradas à mão. Na primeira consulta ao
                tribunal, o histórico será registrado <strong>sem aviso</strong> aos clientes e
                responsáveis (eles já foram informados). Só o que for novo a partir daí é avisado.
              </p-message>
            }
            @if (slotHeldUntil(); as until) {
              <p class="muted small">
                A vaga de sincronização deste processo continua ocupada até {{ until }} (regra do
                plano contra rodízio). Religar este processo nesse período usa a mesma vaga.
              </p>
            }
            @if (process()!.lastCheckError && !process()!.checkRequestedAt) {
              <p-message
                severity="warn"
                styleClass="w-full tracking__error"
                text="A última consulta ao tribunal falhou. Tente novamente mais tarde."
              />
            }
          </p-card>
        }

        @case ('movimentacoes') {
          @if (process()!.trackingEnabled) {
            <p-message severity="info" styleClass="w-full section">
              Sincronização automática ligada: as movimentações vêm do tribunal. As cadastradas à
              mão ficam guardadas e voltam a aparecer se a sincronização for desligada.
            </p-message>
          } @else {
            <p-message severity="secondary" styleClass="w-full section">
              Processo sem sincronização automática: as movimentações são cadastradas aqui, à mão, e
              avisadas aos clientes e responsáveis como as do tribunal.
            </p-message>
          }

          @if (canAddManual()) {
            <p-card header="Nova movimentação" styleClass="section">
              <form class="manual" (ngSubmit)="saveManual()">
                <div class="field">
                  <label for="manualDate">Data</label>
                  <input
                    pInputText
                    id="manualDate"
                    type="date"
                    name="manualDate"
                    [max]="today"
                    [ngModel]="manualDate()"
                    (ngModelChange)="manualDate.set($event)"
                  />
                </div>
                <div class="field">
                  <label for="manualTitle">O que aconteceu</label>
                  <input
                    pInputText
                    id="manualTitle"
                    name="manualTitle"
                    placeholder="Ex.: Audiência de conciliação realizada"
                    [ngModel]="manualTitle()"
                    (ngModelChange)="manualTitle.set($event)"
                  />
                </div>
                <div class="field field--full">
                  <label for="manualDetail">Detalhes (opcional)</label>
                  <textarea
                    pTextarea
                    id="manualDetail"
                    name="manualDetail"
                    rows="3"
                    [ngModel]="manualDetail()"
                    (ngModelChange)="manualDetail.set($event)"
                  ></textarea>
                </div>
                <div class="core-actions field--full">
                  @if (editingMovementId()) {
                    <p-button
                      type="button"
                      size="small"
                      severity="secondary"
                      [text]="true"
                      icon="pi pi-times"
                      label="Cancelar"
                      (onClick)="resetManualForm()"
                    />
                  }
                  <p-button
                    type="submit"
                    size="small"
                    [icon]="editingMovementId() ? 'pi pi-check' : 'pi pi-plus'"
                    [label]="editingMovementId() ? 'Salvar correção' : 'Adicionar movimentação'"
                    [loading]="savingManual()"
                  />
                </div>
                @if (editingMovementId()) {
                  <p class="muted small field--full">
                    A correção não reenvia a mensagem para quem já foi avisado.
                  </p>
                }
              </form>
            </p-card>
          }

          <p-card header="Movimentações" styleClass="section">
            @if (movementsLoading()) {
              <div class="center"><p-progressSpinner styleClass="spinner-sm" /></div>
            } @else if (movements().length === 0) {
              <p class="muted">
                @if (process()!.trackingEnabled) {
                  Nenhuma movimentação coletada ainda. A coleta roda diariamente e as movimentações
                  aparecem aqui assim que forem encontradas.
                } @else {
                  Nenhuma movimentação cadastrada.
                }
              </p>
            } @else {
              <ol class="movements">
                @for (m of movements(); track m.id) {
                  <li>
                    <div class="movements__meta">
                      <span class="movements__date">{{
                        m.occurredAt ? fmtDate(m.occurredAt) : 'Sem data'
                      }}</span>
                      <p-tag
                        [severity]="m.manual ? 'info' : 'secondary'"
                        [value]="m.manual ? 'Manual' : sourceLabel(m.sourceKind)"
                      />
                      @if (m.manual && canManageManual() && !process()!.trackingEnabled) {
                        <span class="movements__actions">
                          <p-button
                            size="small"
                            [text]="true"
                            icon="pi pi-pencil"
                            label="Corrigir"
                            (onClick)="editManual(m)"
                          />
                          <p-button
                            size="small"
                            [text]="true"
                            severity="danger"
                            icon="pi pi-trash"
                            label="Excluir"
                            (onClick)="deleteManual(m)"
                          />
                        </span>
                      }
                    </div>
                    <p class="movements__desc">{{ m.description }}</p>
                    <span class="movements__collected"
                      >{{ m.manual ? 'cadastrada em' : 'coletado em' }}
                      {{ fmt(m.collectedAt) }}</span
                    >
                  </li>
                }
              </ol>
            }
          </p-card>
        }

        @case ('notificacoes') {
          @if (whatsappOffline()) {
            <p-message severity="warn" styleClass="w-full section">
              O WhatsApp do escritório está desconectado. Nenhum aviso é perdido: eles ficam
              pendentes e saem automaticamente assim que o WhatsApp for conectado.
            </p-message>
          }

          <p-card header="O que é enviado" styleClass="section">
            @if (notifLoading()) {
              <div class="center"><p-progressSpinner styleClass="spinner-sm" /></div>
            } @else {
              <p class="muted small">
                {{
                  notifOverride()
                    ? 'Este processo tem configuração própria.'
                    : 'Este processo segue a configuração do escritório.'
                }}
                Mudanças valem também para o que ainda não foi avisado: quem passar a receber ganha,
                numa mensagem, as movimentações que ficaram para trás.
              </p>
              <div class="outgoing">
                @for (a of audienceMessages(); track a.audience) {
                  <div class="outgoing__item">
                    <div class="outgoing__head">
                      <strong>{{ a.title }}</strong>
                      @if (a.enabled) {
                        <p-tag severity="success" value="Recebe avisos" />
                      } @else {
                        <p-tag severity="secondary" value="Não recebe" />
                      }
                    </div>
                    <span class="muted small">Template: {{ a.templateName }}</span>
                    @if (a.enabled) {
                      <jf-whatsapp-preview [title]="a.title" [text]="a.preview" />
                    }
                  </div>
                }
              </div>
            }
          </p-card>

          @if (canEdit()) {
            <p-card header="Personalizar notificações deste processo" styleClass="section">
              @if (notifLoading()) {
                <div class="center"><p-progressSpinner styleClass="spinner-sm" /></div>
              } @else if (!notifOverride()) {
                <p class="muted">Este processo usa a configuração geral do escritório.</p>
                <p-button
                  size="small"
                  severity="secondary"
                  [outlined]="true"
                  icon="pi pi-sliders-h"
                  label="Personalizar"
                  (onClick)="enableNotifOverride()"
                />
              } @else {
                <div class="notif-row">
                  <label class="chk" for="notifResponsible">
                    <p-checkbox
                      inputId="notifResponsible"
                      [binary]="true"
                      [ngModel]="notifResponsible()"
                      (ngModelChange)="notifResponsible.set($event)"
                      [ngModelOptions]="{ standalone: true }"
                    />
                    Notificar os responsáveis
                  </label>
                  <p-select
                    class="f"
                    [disabled]="!notifResponsible()"
                    [options]="responsibleTemplateOptions()"
                    [ngModel]="notifResponsibleTemplateId()"
                    (ngModelChange)="notifResponsibleTemplateId.set($event)"
                    [ngModelOptions]="{ standalone: true }"
                  />
                </div>
                <div class="notif-row">
                  <label class="chk" for="notifClients">
                    <p-checkbox
                      inputId="notifClients"
                      [binary]="true"
                      [ngModel]="notifClients()"
                      (ngModelChange)="notifClients.set($event)"
                      [ngModelOptions]="{ standalone: true }"
                    />
                    Notificar os clientes
                  </label>
                  <p-select
                    class="f"
                    [disabled]="!notifClients()"
                    [options]="clientTemplateOptions()"
                    [ngModel]="notifClientTemplateId()"
                    (ngModelChange)="notifClientTemplateId.set($event)"
                    [ngModelOptions]="{ standalone: true }"
                  />
                </div>
                <div class="core-actions">
                  <p-button
                    size="small"
                    icon="pi pi-check"
                    label="Salvar"
                    [loading]="notifSaving()"
                    (onClick)="saveNotifOverride()"
                  />
                  <p-button
                    size="small"
                    severity="secondary"
                    [text]="true"
                    icon="pi pi-undo"
                    label="Voltar ao padrão do escritório"
                    (onClick)="removeNotifOverride()"
                  />
                </div>
              }
            </p-card>

            <p-card header="Tipos de movimentação avisados neste processo" styleClass="section">
              <p class="muted">
                Ligue só o que interessa a este processo. O que não for personalizado segue o padrão
                do escritório.
              </p>
              <jf-movement-type-toggles [processId]="id()" />
            </p-card>
          }

          <p-card header="Notificações enviadas" styleClass="section">
            @if (deliveries().length === 0) {
              <p class="muted">Nenhuma notificação de WhatsApp enviada para este processo ainda.</p>
            } @else {
              <p-table [value]="deliveries()" styleClass="p-datatable-sm">
                <ng-template pTemplate="header">
                  <tr>
                    <th>Data</th>
                    <th>Destinatário</th>
                    <th>Telefone</th>
                    <th>Status</th>
                  </tr>
                </ng-template>
                <ng-template pTemplate="body" let-d>
                  <tr>
                    <td>{{ fmt(d.at) }}</td>
                    <td>{{ d.recipientName }}</td>
                    <td>{{ d.phone }}</td>
                    <td>
                      @if (d.status === 'sent') {
                        <p-tag severity="success" value="Enviada" />
                      } @else {
                        <p-tag severity="danger" value="Falhou" [attr.title]="d.error" />
                      }
                    </td>
                  </tr>
                </ng-template>
              </p-table>
            }
          </p-card>
        }

        @case ('responsaveis') {
          <p-card header="Responsáveis" styleClass="section">
            <ul class="linked">
              @for (r of process()!.responsibles; track r.profileId) {
                <li>
                  <span>{{ r.name }}</span>
                  @if (isAdmin()) {
                    <p-button
                      size="small"
                      [text]="true"
                      icon="pi pi-times"
                      label="Remover"
                      [disabled]="process()!.responsibles.length <= 1"
                      (onClick)="removeResponsible(r.profileId, r.name)"
                    />
                  }
                </li>
              }
            </ul>
            @if (isAdmin()) {
              <div class="transfer">
                <p-select
                  class="f"
                  [options]="addResponsibleOptions()"
                  [ngModel]="newResponsible()"
                  (ngModelChange)="newResponsible.set($event)"
                  [ngModelOptions]="{ standalone: true }"
                  placeholder="Incluir responsável…"
                />
                <p-button
                  size="small"
                  icon="pi pi-user-plus"
                  [disabled]="!newResponsible()"
                  [loading]="savingResponsible()"
                  label="Incluir"
                  (onClick)="addResponsible()"
                />
              </div>
              <p class="muted small">
                Todo processo tem ao menos um responsável. Quem é incluído recebe, numa mensagem, as
                movimentações que já foram avisadas. Quem é removido perde o acesso ao processo na
                hora; o histórico é preservado.
              </p>
            }
          </p-card>

          @if (isAdmin()) {
            <p-card header="Histórico de responsabilidade" styleClass="section">
              @if (history().length === 0) {
                <p class="muted">Sem histórico.</p>
              } @else {
                <p-table [value]="history()" styleClass="p-datatable-sm">
                  <ng-template pTemplate="header">
                    <tr>
                      <th>Responsável</th>
                      <th>Motivo</th>
                      <th>Início</th>
                      <th>Fim</th>
                      <th>Atribuído por</th>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="body" let-h>
                    <tr>
                      <td>{{ h.responsibleName }}</td>
                      <td>{{ reasonText(h.reason) }}</td>
                      <td>{{ fmt(h.startedAt) }}</td>
                      <td>{{ h.endedAt ? fmt(h.endedAt) : 'atual' }}</td>
                      <td>{{ h.assignedByName || '—' }}</td>
                    </tr>
                  </ng-template>
                </p-table>
              }
            </p-card>
          }
        }

        @case ('clientes') {
          <p-card header="Clientes vinculados" styleClass="section">
            @if (clients().length === 0) {
              <p class="muted">Nenhum cliente vinculado.</p>
            } @else {
              <ul class="linked">
                @for (c of clients(); track c.linkId) {
                  <li>
                    <a [routerLink]="['/clientes', c.clientId]">{{ c.name }}</a>
                    <span class="muted">{{
                      c.type === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física'
                    }}</span>
                    @if (canEdit()) {
                      <p-button
                        size="small"
                        [text]="true"
                        icon="pi pi-times"
                        label="Remover"
                        (onClick)="detach(c)"
                      />
                    }
                  </li>
                }
              </ul>
            }
            @if (canEdit()) {
              <div class="attach">
                <input
                  pInputText
                  type="text"
                  placeholder="Buscar cliente por nome"
                  [value]="term()"
                  (input)="onSearch($event)"
                />
                @if (results().length) {
                  <ul class="results">
                    @for (r of results(); track r.id) {
                      <li>
                        <span
                          >{{ r.name }} <small class="muted">{{ r.type }}</small></span
                        >
                        <p-button
                          size="small"
                          [text]="true"
                          icon="pi pi-link"
                          label="Vincular"
                          (onClick)="attach(r)"
                        />
                      </li>
                    }
                  </ul>
                }
              </div>
              <p class="muted small">
                Cliente vinculado que aceita avisos recebe, numa mensagem, as movimentações que já
                foram avisadas.
              </p>
            }
          </p-card>
        }
      }
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
      :host ::ng-deep .back-btn {
        display: inline-block;
      }
      /* 2 colunas fixas — igual ao resto do app: sem isso, um form com poucos
         campos afunda num cantinho do card e sobra vão vazio do lado. */
      .core {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 0.85rem 1.25rem;
        align-items: start;
      }
      @media (max-width: 32rem) {
        .core {
          grid-template-columns: 1fr;
        }
      }
      .field--full {
        grid-column: 1 / -1;
      }
      .ro {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
      }
      .ro span {
        font-size: 0.78rem;
        color: var(--jf-text-muted, #64748b);
      }
      .muted {
        color: var(--jf-text-muted, #64748b);
      }
      .small {
        font-size: 0.8rem;
      }
      .linked,
      .results {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }
      .linked li,
      .results li {
        display: flex;
        gap: 0.6rem;
        align-items: center;
        flex-wrap: wrap;
      }
      .movements {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.9rem;
      }
      .movements li {
        padding-bottom: 0.9rem;
        border-bottom: 1px solid var(--jf-border, #e2e8f0);
      }
      .movements li:last-child {
        border-bottom: 0;
        padding-bottom: 0;
      }
      .movements__meta {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .movements__date {
        font-size: 0.8125rem;
        font-weight: 600;
      }
      .movements__desc {
        margin: 0.4rem 0 0.2rem;
        font-size: 0.9rem;
      }
      .movements__collected {
        font-size: 0.75rem;
        color: var(--jf-text-muted, #64748b);
      }
      .attach {
        margin-top: 0.85rem;
      }
      .tracking {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        flex-wrap: wrap;
      }
      .sync {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        margin-top: 0.85rem;
        font-size: 0.9rem;
      }
      .tracking__info {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        flex-wrap: wrap;
      }
      :host ::ng-deep .tracking__error {
        margin-top: 0.75rem;
      }
      .attach input {
        width: 100%;
        max-width: 24rem;
      }
      .transfer {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        flex-wrap: wrap;
      }
      .transfer .f {
        min-width: 16rem;
      }
      .notif-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.75rem;
        padding: 0.6rem 0;
        border-bottom: 1px solid var(--jf-border, #e2e8f0);
      }
      .chk {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.9rem;
        min-width: 14rem;
      }
      .notif-row .f {
        min-width: 14rem;
      }
      .tabs {
        margin-bottom: 1rem;
        overflow-x: auto;
      }
      .manual {
        display: grid;
        grid-template-columns: minmax(10rem, 14rem) minmax(0, 1fr);
        gap: 0.85rem 1.25rem;
      }
      @media (max-width: 40rem) {
        .manual {
          grid-template-columns: 1fr;
        }
      }
      .manual textarea {
        width: 100%;
        resize: vertical;
      }
      .movements__actions {
        margin-left: auto;
        display: flex;
        gap: 0.25rem;
      }
      .movements__desc {
        white-space: pre-wrap;
      }
      .outgoing {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1.25rem;
        margin-top: 0.75rem;
      }
      @media (max-width: 48rem) {
        .outgoing {
          grid-template-columns: 1fr;
        }
      }
      .outgoing__item {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .outgoing__head {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      :host ::ng-deep .w-full {
        width: 100%;
      }
    `,
  ],
})
export class ProcessDetailComponent {
  readonly id = input.required<string>();

  private readonly fb = inject(FormBuilder);
  private readonly service = inject(ProcessService);
  private readonly clientService = inject(ClientService);
  private readonly membersService = inject(SpaceMembersService);
  private readonly activeSpace = inject(ActiveSpaceService);
  private readonly auth = inject(AuthService);
  private readonly permissions = inject(PermissionService);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly whatsappService = inject(WhatsappService);
  private readonly notifConfigService = inject(NotificationConfigService);
  private readonly templateService = inject(TemplateService);
  private readonly pageHeader = inject(PageHeaderService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(true);
  protected readonly process = signal<ProcessDetail | null>(null);
  protected readonly tab = signal<Tab>(initialTab(this.route.snapshot.queryParamMap.get('aba')));
  protected readonly clients = signal<LinkedClient[]>([]);
  protected readonly movements = signal<MovementRow[]>([]);
  protected readonly movementsLoading = signal(true);
  protected readonly deliveries = signal<DeliveryRow[]>([]);
  protected readonly requestingCheck = signal(false);
  private checkPoll: ReturnType<typeof setInterval> | null = null;

  /** Motivo de "Consultar agora" estar indisponível — mesmas regras da RPC request_process_check. */
  protected readonly checkBlockedReason = computed((): string => {
    const p = this.process();
    if (!p) return '';
    if (p.status !== 'active') return 'Só processos ativos são consultados no tribunal.';
    if (!p.trackingEnabled)
      return 'Ligue a sincronização automática para consultar este processo no tribunal.';
    if (!p.cnjNumber) return 'Informe o número CNJ para consultar o processo no tribunal.';
    if (!p.courtTracked) return 'Este tribunal ainda não tem consulta automática.';
    return '';
  });
  protected readonly history = signal<HistoryRow[]>([]);
  protected readonly members = signal<SpaceMemberOption[]>([]);
  protected readonly savingCore = signal(false);
  protected readonly savingResponsible = signal(false);
  protected readonly newResponsible = signal('');
  protected readonly savingTracking = signal(false);

  /** Hoje (AAAA-MM-DD, fuso local): limite do campo de data da movimentação manual. */
  protected readonly today = isoDay(new Date());
  protected readonly manualDate = signal(isoDay(new Date()));
  protected readonly manualTitle = signal('');
  protected readonly manualDetail = signal('');
  protected readonly savingManual = signal(false);
  protected readonly editingMovementId = signal<string | null>(null);
  /** ADMIN ou responsável cadastram; só em processo ativo sem sincronização. */
  protected readonly canAddManual = computed(() => {
    const p = this.process();
    return !!p && this.canEdit() && p.status === 'active' && !p.trackingEnabled;
  });
  /** Corrigir/excluir: ADMIN ou quem cadastrou o processo (0048). */
  protected readonly canManageManual = computed(() => {
    const p = this.process();
    return !!p && (this.isAdmin() || p.createdBy === this.auth.userId());
  });
  /** Carência anti-rodízio do plano do espaço (dias). */
  private readonly holdDays = signal(30);
  /** Data em que a vaga de sincronização volta a ficar livre (anti-rodízio). */
  protected readonly slotHeldUntil = computed((): string | null => {
    const released = this.process()?.trackingReleasedAt;
    if (!released) return null;
    const until = new Date(new Date(released).getTime() + this.holdDays() * 86_400_000);
    return until.getTime() > Date.now() ? until.toLocaleDateString('pt-BR') : null;
  });
  private readonly reasonLabel: Record<HistoryRow['reason'], string> = {
    process_created: 'Cadastro',
    transfer: 'Transferência',
    added: 'Inclusão',
  };
  protected readonly reasonText = (r: HistoryRow['reason']): string => this.reasonLabel[r];
  protected readonly term = signal('');
  protected readonly results = signal<Client[]>([]);
  protected readonly msg = signal<{ tone: 'error' | 'success' | 'warn'; text: string } | null>(
    null,
  );

  protected readonly notifLoading = signal(true);
  protected readonly notifOverride = signal(false);
  protected readonly notifSaving = signal(false);
  protected readonly notifResponsible = signal(true);
  protected readonly notifClients = signal(true);
  protected readonly notifResponsibleTemplateId = signal('');
  protected readonly notifClientTemplateId = signal('');
  private readonly notifTemplates = signal<MessageTemplate[]>([]);
  private readonly spaceNotifConfig = signal<SpaceNotificationConfig | null>(null);
  /** Configuração salva do processo (null = segue o escritório) — o que o worker usa. */
  private readonly savedOverride = signal<SavedOverride | null>(null);
  private readonly whatsappStatus = signal<WhatsappSessionStatus | null>(null);
  /** Só o ADMIN enxerga a sessão do WhatsApp; para os demais, null = não mostra o aviso. */
  protected readonly whatsappOffline = computed(() => {
    const status = this.whatsappStatus();
    return status !== null && status !== 'connected';
  });
  protected readonly notifResponsibleTemplates = computed(() =>
    this.notifTemplates().filter((t) => t.audience === 'responsible'),
  );
  protected readonly notifClientTemplates = computed(() =>
    this.notifTemplates().filter((t) => t.audience === 'client'),
  );
  protected readonly responsibleTemplateOptions = computed(() => [
    { label: this.inheritedTemplateLabel('responsible'), value: '' },
    ...this.notifResponsibleTemplates().map((t) => ({ label: t.name, value: t.id })),
  ]);
  protected readonly clientTemplateOptions = computed(() => [
    { label: this.inheritedTemplateLabel('client'), value: '' },
    ...this.notifClientTemplates().map((t) => ({ label: t.name, value: t.id })),
  ]);

  /**
   * O que o worker envia hoje para cada público: config do processo, senão a
   * do escritório, senão o padrão do sistema (mesma regra de
   * resolveEffectiveConfig no scraper-worker).
   */
  protected readonly audienceMessages = computed(() => {
    const own = this.savedOverride();
    const space = this.spaceNotifConfig();
    const byId = new Map(this.notifTemplates().map((t) => [t.id, t]));
    const build = (audience: 'responsible' | 'client', title: string) => {
      const enabled =
        (audience === 'responsible' ? own?.notifyResponsible : own?.notifyClients) ??
        (audience === 'responsible' ? space?.notifyResponsible : space?.notifyClients) ??
        true;
      const templateId =
        (audience === 'responsible' ? own?.responsibleTemplateId : own?.clientTemplateId) ??
        (audience === 'responsible' ? space?.responsibleTemplateId : space?.clientTemplateId) ??
        null;
      const template = templateId ? byId.get(templateId) : undefined;
      return {
        audience,
        title,
        enabled,
        templateName: template?.name ?? DEFAULT_TEMPLATE_NAME,
        preview: renderMessagePreview(templateBodyOrDefault(template?.body)),
      };
    };
    return [build('responsible', 'Responsáveis'), build('client', 'Clientes')];
  });

  protected readonly tabOptions = computed(() => {
    const p = this.process();
    const count = (n: number | undefined): string => (n ? ` (${n})` : '');
    return [
      { label: 'Resumo', value: 'resumo' as Tab },
      { label: `Movimentações${count(this.movements().length)}`, value: 'movimentacoes' as Tab },
      { label: 'Notificações', value: 'notificacoes' as Tab },
      { label: `Responsáveis${count(p?.responsibles.length)}`, value: 'responsaveis' as Tab },
      { label: `Clientes${count(this.clients().length)}`, value: 'clientes' as Tab },
    ];
  });
  protected readonly responsibleNames = computed(
    () =>
      this.process()
        ?.responsibles.map((r) => r.name)
        .join(', ') || '—',
  );
  protected readonly addResponsibleOptions = computed(() => {
    const current = new Set(this.process()?.responsibles.map((r) => r.profileId));
    return [
      { label: 'Incluir responsável…', value: '' },
      ...this.members()
        .filter((m) => !current.has(m.profileId))
        .map((m) => ({
          label: `${m.fullName} (${m.role === 'ADMIN' ? 'Administrador' : 'Colaborador'})`,
          value: m.profileId,
        })),
    ];
  });

  protected readonly coreForm = this.fb.nonNullable.group({ cnjNumber: '', internalRef: '' });

  protected fmt(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR');
  }

  protected sourceLabel(sourceKind: string): string {
    return sourceKind === 'projudi_tjam' ? 'Projudi/TJAM' : sourceKind;
  }

  protected readonly isAdmin = (): boolean => this.permissions.can('space.manage');
  /** ADMIN ou qualquer um dos responsáveis atuais (mesma regra de app.can_edit_process). */
  protected readonly canEdit = computed(() => {
    const p = this.process();
    if (!p) return false;
    const me = this.auth.userId();
    return this.permissions.can('space.manage') || p.responsibles.some((r) => r.profileId === me);
  });
  protected readonly statusTone = (): 'success' | 'secondary' | 'warn' => {
    const s = this.process()?.status;
    return s === 'active' ? 'success' : s === 'closed' ? 'secondary' : 'warn';
  };
  private readonly statusLabel: Record<string, string> = {
    active: 'Ativo',
    archived: 'Arquivado',
    closed: 'Encerrado',
  };

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  protected selectTab(tab: Tab): void {
    if (!tab || tab === this.tab()) return;
    this.tab.set(tab);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { aba: tab === 'resumo' ? null : tab },
      replaceUrl: true,
    });
  }

  private inheritedTemplateLabel(audience: 'responsible' | 'client'): string {
    const space = this.spaceNotifConfig();
    const id = audience === 'responsible' ? space?.responsibleTemplateId : space?.clientTemplateId;
    const name = this.notifTemplates().find((t) => t.id === id)?.name ?? DEFAULT_TEMPLATE_NAME;
    return `Padrão do escritório (${name})`;
  }

  constructor() {
    // allowSignalWrites: sem ele o Angular 18 lança NG0600 e o título nunca chega à topbar.
    effect(
      () => {
        const p = this.process();
        this.pageHeader.set(
          p?.cnjNumber || p?.internalRef || 'Processo',
          p ? this.statusLabel[p.status] : undefined,
        );
      },
      { allowSignalWrites: true },
    );
    queueMicrotask(() => void this.load());
    this.destroyRef.onDestroy(() => this.stopCheckPoll());
  }

  protected async requestCheck(): Promise<void> {
    const p = this.process();
    if (!p) return;
    this.requestingCheck.set(true);
    try {
      await this.service.requestCheck(p.id);
      this.process.set({ ...p, checkRequestedAt: new Date().toISOString() });
      this.toast.success('Consulta solicitada. O resultado aparece aqui em instantes.');
      this.startCheckPoll();
    } catch (err) {
      // As mensagens da RPC (intervalo mínimo, CNJ, tribunal) já são para o usuário.
      const m = (err as { code?: string; message?: string }) ?? {};
      this.toast.error(
        m.code === '23514' && m.message ? m.message : 'Não foi possível solicitar a consulta.',
      );
    } finally {
      this.requestingCheck.set(false);
    }
  }

  /**
   * Acompanha o pedido até o worker concluir (check_requested_at volta a
   * NULL) e então recarrega movimentações e envios. Desiste após ~5 min —
   * worker parado não deixa a tela fazendo polling para sempre.
   */
  private startCheckPoll(): void {
    this.stopCheckPoll();
    const startedAt = Date.now();
    this.checkPoll = setInterval(async () => {
      const p = this.process();
      if (!p || Date.now() - startedAt > 5 * 60_000) {
        this.stopCheckPoll();
        return;
      }
      try {
        const state = await this.service.trackingState(p.id);
        if (state.checkRequestedAt) return;
        this.stopCheckPoll();
        this.process.set({ ...p, ...state });
        const [movements, deliveries] = await Promise.all([
          this.service.movements(p.id),
          this.service.deliveries(p.id),
        ]);
        this.movements.set(movements);
        this.deliveries.set(deliveries);
        if (state.lastCheckError) this.toast.warning('A consulta ao tribunal falhou.');
        else this.toast.success('Consulta concluída.');
      } catch {
        // Falha transitória de rede: tenta de novo no próximo intervalo.
      }
    }, 5000);
  }

  private stopCheckPoll(): void {
    if (this.checkPoll) clearInterval(this.checkPoll);
    this.checkPoll = null;
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const p = await this.service.getById(this.id());
      this.process.set(p);
      if (!p) return;
      // Pedido feito em outra aba/sessão ainda na fila: segue acompanhando.
      if (p.checkRequestedAt) this.startCheckPoll();
      this.coreForm.patchValue({ cnjNumber: p.cnjNumber ?? '', internalRef: p.internalRef ?? '' });
      const tasks: Promise<unknown>[] = [
        this.service.listClients(p.id).then((c) => this.clients.set(c)),
        this.service
          .planUsage()
          .then((u) => this.holdDays.set(u.trackingHoldDays))
          .catch(() => undefined),
        this.service
          .movements(p.id)
          .then((m) => this.movements.set(m))
          .finally(() => this.movementsLoading.set(false)),
        this.service.deliveries(p.id).then((d) => this.deliveries.set(d)),
      ];
      if (this.isAdmin()) {
        const spaceId = this.activeSpace.activeSpaceId();
        tasks.push(this.service.history(p.id).then((h) => this.history.set(h)));
        if (spaceId)
          tasks.push(this.membersService.listActive(spaceId).then((m) => this.members.set(m)));
      }
      tasks.push(this.loadNotifConfig(p.id));
      if (this.isAdmin())
        tasks.push(
          this.whatsappService
            .getSession()
            .then((session) => this.whatsappStatus.set(session?.status ?? 'disconnected'))
            .catch(() => this.whatsappStatus.set(null)),
        );
      await Promise.all(tasks);
    } catch {
      this.toast.error('Não foi possível carregar o processo.');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadNotifConfig(processId: string): Promise<void> {
    this.notifLoading.set(true);
    try {
      const [config, spaceConfig, templates] = await Promise.all([
        this.notifConfigService.getForProcess(processId),
        this.notifConfigService.getForSpace(),
        this.templateService.list('movement'),
      ]);
      this.notifTemplates.set(templates);
      this.spaceNotifConfig.set(spaceConfig);
      this.savedOverride.set(config);
      this.notifOverride.set(config !== null);
      if (config) {
        this.notifResponsible.set(config.notifyResponsible ?? true);
        this.notifClients.set(config.notifyClients ?? true);
        this.notifResponsibleTemplateId.set(config.responsibleTemplateId ?? '');
        this.notifClientTemplateId.set(config.clientTemplateId ?? '');
      }
    } catch {
      this.toast.error('Não foi possível carregar as notificações do processo.');
    } finally {
      this.notifLoading.set(false);
    }
  }

  protected enableNotifOverride(): void {
    this.notifOverride.set(true);
  }

  protected async saveNotifOverride(): Promise<void> {
    const p = this.process();
    if (!p) return;
    this.notifSaving.set(true);
    try {
      const input = {
        notifyResponsible: this.notifResponsible(),
        notifyClients: this.notifClients(),
        responsibleTemplateId: this.notifResponsibleTemplateId() || null,
        clientTemplateId: this.notifClientTemplateId() || null,
      };
      await this.notifConfigService.upsertForProcess(p.id, input);
      this.savedOverride.set(input);
      this.toast.success(
        'Notificações atualizadas. O que ainda não foi avisado sai em instantes, sem nova consulta.',
      );
    } catch {
      this.toast.error('Não foi possível salvar as notificações do processo.');
    } finally {
      this.notifSaving.set(false);
    }
  }

  protected async removeNotifOverride(): Promise<void> {
    const p = this.process();
    if (!p) return;
    try {
      await this.notifConfigService.clearProcessOverride(p.id);
      this.notifOverride.set(false);
      this.savedOverride.set(null);
      this.toast.success('Processo voltou a usar o padrão do espaço.');
    } catch {
      this.toast.error('Não foi possível remover a personalização.');
    }
  }

  protected async saveCore(): Promise<void> {
    if (!this.canEdit()) return;
    this.savingCore.set(true);
    this.msg.set(null);
    try {
      const v = this.coreForm.getRawValue();
      await this.service.updateCore(this.id(), {
        cnjNumber: v.cnjNumber.trim() || null,
        internalRef: v.internalRef.trim() || null,
      });
      this.toast.success('Dados atualizados.');
      await this.load();
    } catch (err) {
      this.msg.set({ tone: 'error', text: this.humanize(err) });
    } finally {
      this.savingCore.set(false);
    }
  }

  protected async setStatus(status: 'active' | 'archived' | 'closed'): Promise<void> {
    this.msg.set(null);
    try {
      await this.service.setStatus(this.id(), status);
      await this.load();
    } catch (err) {
      this.msg.set({ tone: 'error', text: this.humanize(err) });
    }
  }

  protected async addResponsible(): Promise<void> {
    const target = this.newResponsible();
    if (!target) return;
    this.savingResponsible.set(true);
    try {
      await this.service.addResponsible(this.id(), target);
      this.newResponsible.set('');
      this.toast.success('Responsável incluído.');
      await this.load();
    } catch (err) {
      this.msg.set({ tone: 'error', text: this.humanize(err) });
    } finally {
      this.savingResponsible.set(false);
    }
  }

  protected async removeResponsible(profileId: string, name: string): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Remover responsável',
      message: `Remover ${name} dos responsáveis? A pessoa perde o acesso ao processo imediatamente.`,
      confirmLabel: 'Remover',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await this.service.removeResponsible(this.id(), profileId);
      this.toast.success('Responsável removido.');
      await this.load();
    } catch (err) {
      this.msg.set({ tone: 'error', text: this.humanize(err) });
    }
  }

  protected async setTracking(enabled: boolean): Promise<void> {
    const p = this.process();
    if (!p) return;
    const ok = await this.dialog.confirm(
      enabled ? this.enableTrackingDialog() : this.disableTrackingDialog(),
    );
    if (!ok) {
      this.process.set({ ...p }); // devolve o switch
      return;
    }
    this.savingTracking.set(true);
    try {
      await this.service.setTracking(p.id, enabled);
      this.toast.success(
        enabled ? 'Sincronização automática ligada.' : 'Sincronização automática desligada.',
      );
      // A fonte das movimentações mudou (tribunal ↔ manuais): recarrega tudo.
      await this.load();
    } catch (err) {
      // Volta o switch para o valor real e explica (ex.: limite do plano).
      this.process.set({ ...p });
      this.toast.error(this.humanize(err));
    } finally {
      this.savingTracking.set(false);
    }
  }

  private enableTrackingDialog(): {
    title: string;
    message: string;
    confirmLabel: string;
  } {
    const hasManual = this.movements().some((m) => m.manual);
    return {
      title: 'Ligar a sincronização automática',
      message:
        'As movimentações passam a vir do tribunal. As cadastradas à mão ficam guardadas e voltam se a sincronização for desligada.' +
        (hasManual
          ? ' Como este processo já tem movimentações manuais, o histórico do tribunal da primeira consulta NÃO será enviado aos clientes e responsáveis (eles já foram informados). Só o que for novo a partir daí será avisado.'
          : ' Na primeira consulta, o histórico do tribunal é enviado aos clientes e responsáveis numa mensagem.'),
      confirmLabel: 'Ligar',
    };
  }

  private disableTrackingDialog(): {
    title: string;
    message: string;
    confirmLabel: string;
    tone: 'danger';
  } {
    const days = this.holdDays();
    const until = new Date(Date.now() + days * 86_400_000);
    return {
      title: 'Desligar a sincronização automática',
      message: `As movimentações do tribunal deixam de aparecer neste processo e os avisos delas param; as cadastradas à mão voltam a valer. A vaga do plano só fica livre em ${days} dias (${until.toLocaleDateString('pt-BR')}) — religar este processo nesse período usa a mesma vaga.`,
      confirmLabel: 'Desligar',
      tone: 'danger',
    };
  }

  protected fmtDate(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('pt-BR');
  }

  protected editManual(m: MovementRow): void {
    const [title, ...detail] = m.description.split('\n');
    this.editingMovementId.set(m.id);
    this.manualDate.set(m.occurredAt ? isoDay(new Date(m.occurredAt)) : this.today);
    this.manualTitle.set(title ?? '');
    this.manualDetail.set(detail.join('\n'));
  }

  protected resetManualForm(): void {
    this.editingMovementId.set(null);
    this.manualDate.set(this.today);
    this.manualTitle.set('');
    this.manualDetail.set('');
  }

  protected async saveManual(): Promise<void> {
    const p = this.process();
    if (!p) return;
    if (!this.manualTitle().trim() || !this.manualDate()) {
      this.toast.error('Informe a data e o que aconteceu.');
      return;
    }
    const input = {
      occurredOn: this.manualDate(),
      title: this.manualTitle(),
      detail: this.manualDetail().trim() || null,
    };
    const editing = this.editingMovementId();
    this.savingManual.set(true);
    try {
      if (editing) {
        await this.service.updateManualMovement(editing, input);
        this.toast.success('Movimentação corrigida.');
      } else {
        await this.service.createManualMovement(p.id, input);
        this.toast.success('Movimentação cadastrada. Os avisos saem em instantes.');
      }
      this.resetManualForm();
      this.movements.set(await this.service.movements(p.id));
    } catch (err) {
      this.toast.error(this.humanize(err));
    } finally {
      this.savingManual.set(false);
    }
  }

  protected async deleteManual(m: MovementRow): Promise<void> {
    const p = this.process();
    if (!p) return;
    const ok = await this.dialog.confirm({
      title: 'Excluir movimentação',
      message:
        'Excluir esta movimentação? Quem já recebeu o aviso não é avisado da exclusão. Fica registrado na auditoria.',
      confirmLabel: 'Excluir',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await this.service.deleteManualMovement(m.id);
      if (this.editingMovementId() === m.id) this.resetManualForm();
      this.toast.success('Movimentação excluída.');
      this.movements.set(await this.service.movements(p.id));
    } catch (err) {
      this.toast.error(this.humanize(err));
    }
  }

  protected async remove(): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Excluir processo',
      message:
        'O processo sai das listas e da contagem do plano. O histórico e a auditoria são mantidos, e ele pode ser restaurado na aba Excluídos.',
      confirmLabel: 'Excluir',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await this.service.softDelete(this.id());
      this.toast.success('Processo excluído.');
      await this.router.navigate(['/processos'], { queryParams: { aba: 'archived' } });
    } catch (err) {
      this.msg.set({ tone: 'error', text: this.humanize(err) });
    }
  }

  protected onSearch(event: Event): void {
    const t = (event.target as HTMLInputElement).value;
    this.term.set(t);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(async () => {
      if (t.trim().length < 2) {
        this.results.set([]);
        return;
      }
      try {
        const linked = new Set(this.clients().map((c) => c.clientId));
        const found = await this.clientService.search(t);
        this.results.set(found.filter((c) => !linked.has(c.id)));
      } catch {
        this.results.set([]);
      }
    }, 250);
  }

  protected async attach(c: Client): Promise<void> {
    try {
      await this.service.attachClient(this.id(), c.id);
      this.term.set('');
      this.results.set([]);
      await this.load();
    } catch (err) {
      this.msg.set({ tone: 'error', text: this.humanize(err) });
    }
  }

  protected async detach(c: LinkedClient): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Remover cliente do processo',
      message: `Desvincular "${c.name}" deste processo?`,
      confirmLabel: 'Remover',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await this.service.detachClient(c.linkId);
      await this.load();
    } catch (err) {
      this.msg.set({ tone: 'error', text: this.humanize(err) });
    }
  }

  private humanize(err: unknown): string {
    const m = (err as { message?: string })?.message ?? '';
    const code = (err as { code?: string })?.code;
    // Regras de negócio do banco já trazem a mensagem para o usuário.
    if (code === '23514' || code === '42501') {
      if (m && !m.includes('row-level security') && !m.includes('permission denied')) return m;
    }
    if (m.includes('Alterar o tribunal')) return 'Só ADMIN altera o tribunal do processo.';
    if (m.includes('novo responsável deve ser um membro ativo'))
      return 'O novo responsável precisa ser membro ativo do espaço.';
    if (m.includes('já é o responsável atual')) return 'Esse usuário já é o responsável atual.';
    if (m.includes('processes_cnj_uniq'))
      return 'Já existe um processo com esse número CNJ neste espaço.';
    if (m.includes('row-level security') || m.includes('permissão') || m.includes('permission'))
      return 'Você não tem permissão para esta ação.';
    return 'Não foi possível concluir a operação.';
  }
}
