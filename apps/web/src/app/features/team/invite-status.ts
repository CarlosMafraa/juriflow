import type { InviteState } from './team.service';

export interface InviteStatusView {
  label: string;
  severity: 'info' | 'success' | 'warn' | 'danger' | 'secondary';
  detail: string;
  /** Faz sentido reenviar (link não aceito e não mais útil, ou ainda pendente). */
  canResend: boolean;
}

const fmt = (iso: string | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

/**
 * Como a tela descreve o link de um convite. Regras: o link vale 24 h, mostra
 * se foi aberto, e um reenvio substitui o anterior.
 */
export function inviteStatus(
  state: InviteState | null,
  sentAt: string | null | undefined,
  expiresAt: string | null | undefined,
  openedAt: string | null | undefined,
): InviteStatusView {
  switch (state) {
    case 'accepted':
      return { label: 'Aceito', severity: 'success', detail: '', canResend: false };
    case 'opened':
      return {
        label: 'Link aberto',
        severity: 'info',
        detail: `Aberto em ${fmt(openedAt)} · vale até ${fmt(expiresAt)}`,
        canResend: true,
      };
    case 'expired':
      return {
        label: 'Expirado',
        severity: 'danger',
        detail: `${openedAt ? `Aberto em ${fmt(openedAt)}, ` : 'Não foi aberto, '}venceu em ${fmt(expiresAt)}`,
        canResend: true,
      };
    case 'superseded':
    case 'cancelled':
      return { label: 'Cancelado', severity: 'secondary', detail: '', canResend: true };
    case 'sent':
      return {
        label: 'Não aberto',
        severity: 'warn',
        detail: `Enviado em ${fmt(sentAt)} · vale até ${fmt(expiresAt)}`,
        canResend: true,
      };
    default:
      return { label: 'Sem convite', severity: 'secondary', detail: '', canResend: false };
  }
}

/** Estado de um convite pendente a partir das datas (lista do ADMIN). */
export function pendingInviteState(
  expiresAt: string,
  openedAt: string | null | undefined,
): InviteState {
  if (new Date(expiresAt).getTime() <= Date.now()) return 'expired';
  return openedAt ? 'opened' : 'sent';
}
