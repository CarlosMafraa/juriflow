/**
 * Seletores da consulta pública do Projudi/TJAM — conferidos no DOM real em
 * 2026-09-26 (processo 0280181-52.2025.8.04.1000). Se o tribunal mudar a
 * página, este é o único arquivo a ajustar; confirme com
 * `npm run inspect --workspace @juriflow/scraper-worker -- <nº do processo>`.
 *
 * Estrutura observada: a busca pelo número único abre direto a página do
 * processo; a aba "Movimentações" traz a tabela `idTableMovimentacoes…` com uma
 * linha `tr#mov<grau>Grau…` por movimentação e as células
 * [ícone, Seq., Data "dd/mm/aaaa hh:mm:ss", Evento (<b>TÍTULO</b><br>detalhe),
 * Movimentado por]. Linhas `rowmovimentacoes…` são o painel de arquivos (ignorar).
 */
export const TJAM_PROJUDI_SELECTORS = {
  /** Campo de número do processo na consulta pública. */
  processNumberInput: '#numeroProcesso',
  /** Botão "Pesquisar". */
  searchButton: '#pesquisar',
  /** Endereço da página de resultado (…/consultaPublica.do;jsessionid=…?actionType=pesquisar). */
  resultUrl: /consultaPublica\.do.*actionType=pesquisar/,
  /** Tabela(s) de movimentações (uma por grau). */
  movementsTable: 'table[id^="idTableMovimentacoes"]',
  /** Cada linha de movimentação dentro da tabela. */
  movementRow: 'tr[id^="mov"][id*="Grau"]',
  /** Texto que indica "processo não encontrado" (para diferenciar de erro real). */
  notFoundText: 'nenhum registro encontrado',
} as const;
