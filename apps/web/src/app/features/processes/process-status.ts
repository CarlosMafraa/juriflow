import type { ProcessStatus } from '@juriflow/shared-types';

/** Rótulos em português dos status de processo (o banco guarda em inglês). */
export const PROCESS_STATUS_LABEL: Record<ProcessStatus, string> = {
  active: 'Ativo',
  archived: 'Arquivado',
  closed: 'Encerrado',
};

export function processStatusSeverity(status: ProcessStatus): 'success' | 'secondary' | 'warn' {
  return status === 'active' ? 'success' : status === 'closed' ? 'secondary' : 'warn';
}
