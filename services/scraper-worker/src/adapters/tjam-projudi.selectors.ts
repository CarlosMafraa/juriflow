/**
 * Único arquivo que deve ser editado depois de inspecionar o DOM real do
 * Projudi/TJAM. Curl não passa pelo desafio anti-bot (F5/Distil) da fonte,
 * então os seletores abaixo são um ponto de partida a partir de padrões
 * conhecidos do Projudi (mesmo motor usado por outros TJs) — **confirme com
 * `npm run inspect --workspace @juriflow/scraper-worker -- <nº do processo>`
 * antes de considerar o adapter pronto para produção.**
 */
export const TJAM_PROJUDI_SELECTORS = {
  /** Campo de número do processo na consulta pública. */
  processNumberInput: 'input[name="numeroProcesso"]',
  /** Botão/link que dispara a busca. */
  searchButton: 'input[type="submit"], button[type="submit"]',
  /** Container que envolve a lista de movimentações do resultado. */
  movementsContainer: '.listaMovimentacoes, table.resultado',
  /** Cada linha de movimentação dentro do container. */
  movementRow: 'tr',
  /** Célula com a data da movimentação, dentro de uma linha. */
  movementDateCell: 'td:nth-child(1)',
  /** Célula com a descrição da movimentação, dentro de uma linha. */
  movementDescriptionCell: 'td:nth-child(2)',
  /** Texto que indica "processo não encontrado" (para diferenciar de erro real). */
  notFoundText: 'não localizado',
} as const;
