/** Rótulos e mensagens do acompanhamento — puros, testáveis. */

const SOURCE_LABELS: Record<string, string> = {
  datajud: 'DataJud (CNJ)',
  tribunal_api: 'API do Tribunal',
  projudi_tjam: 'Projudi / TJAM',
  scraper: 'Consulta pública',
};

export function sourceLabel(sourceKind: string): string {
  return SOURCE_LABELS[sourceKind] ?? sourceKind;
}

/** DataJud pode estar defasado em relação ao tribunal. */
export function hasDelayWarning(sourceKind: string): boolean {
  return sourceKind === 'datajud';
}

const ERROR_MESSAGES: Record<string, string> = {
  timeout: 'A fonte demorou a responder. Tentaremos novamente.',
  unavailable: 'A fonte está indisponível no momento. Tentaremos novamente.',
  rate_limited: 'Limite de consultas da fonte atingido. Tentaremos novamente mais tarde.',
  auth_failed: 'Credenciais da fonte inválidas ou expiradas. Um administrador precisa revisar.',
  parse_error: 'A resposta da fonte mudou de formato. Estamos verificando.',
  not_found: 'O processo não foi encontrado nesta fonte.',
  unknown: 'Não foi possível concluir a coleta. Tentaremos novamente.',
};

export function friendlyCollectionError(code: string | null | undefined): string {
  if (!code) return '';
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES['unknown']!;
}

export function collectionStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'success':
      return 'Concluída';
    case 'partial':
      return 'Parcial (será completada na próxima)';
    case 'failed':
      return 'Falhou';
    case 'running':
      return 'Em andamento';
    case 'pending':
      return 'Na fila';
    default:
      return '—';
  }
}
