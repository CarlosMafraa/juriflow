/**
 * `@juriflow/adapter-playwright` — Etapa 9 (MVP).
 *
 * Estrutura mínima onde um scraper por navegador vai encaixar na Etapa 10.
 * NENHUM scraping é feito aqui — só o contrato.
 *
 * Camadas:
 *
 *   Application  →  ProcessDataSource (@juriflow/collectors-core)
 *                →  PlaywrightCollector (este pacote)
 *                →  BrowserCaseRunner  ← implementação Playwright + Edge (Etapa 10)
 *                →  fonte externa
 *
 * O domínio e o `PlaywrightCollector` só conhecem `BrowserCaseRunner`. Detalhes de
 * navegador, seletores, carregamento de página e Playwright NÃO vazam daqui.
 */

/** Entrada de uma consulta de processo, já sem acoplamento ao modelo de dados. */
export interface BrowserCaseQuery {
  /** Número CNJ (com ou sem pontuação); a implementação normaliza. */
  readonly cnjNumber: string;
  /** Id do tribunal no catálogo do JuriFlow — a impl decide URL/fluxo por ele. */
  readonly courtId: string;
  /** Parâmetros específicos da fonte (opcional). */
  readonly params?: Readonly<Record<string, unknown>>;
  /** Correlação para logs/auditoria (opcional). */
  readonly requestId?: string;
}

/** Uma movimentação como saiu da página, ainda CRUA (sem normalização). */
export interface BrowserMovement {
  /**
   * Id estável da movimentação na fonte, quando a página fornecer um
   * (ex.: número sequencial do andamento). `null` quando a fonte não dá.
   */
  readonly sourceMovementId: string | null;
  /** Data/hora informada pela página, como veio (string). `null` se ausente. */
  readonly occurredAt: string | null;
  /** Título/evento da movimentação. */
  readonly description: string;
  /** Qualquer dado extra que a impl queira preservar para auditoria (opcional). */
  readonly raw?: unknown;
}

/**
 * Resultado de uma consulta:
 *   - `found`     → o processo existe; `movements` é a lista (pode ser vazia).
 *                   `partial: true` quando a página não entregou tudo.
 *   - `not_found` → o processo não existe na fonte.
 *
 * ERROS DE CONSULTA (fonte indisponível, timeout, HTML inesperado, Edge ausente,
 * bloqueio anti-bot, …) NÃO são representados aqui: a implementação LANÇA um
 * `CollectionError` do `@juriflow/collector-engine` (`CollectionUnavailableError`,
 * `CollectionTimeoutError`, `CollectionParseError`, `CollectionRateLimitedError`,
 * `CollectionAuthError`, ou `new CollectionError('unknown', …, false)`).
 */
export type BrowserCaseOutcome =
  | {
      readonly status: 'found';
      readonly movements: readonly BrowserMovement[];
      readonly partial?: boolean;
    }
  | { readonly status: 'not_found' };

/**
 * Porta de navegação por navegador.
 *
 * IMPLEMENTAÇÃO DE PRODUÇÃO — Etapa 10 (Playwright + Microsoft Edge):
 *   browserType.launch({ channel: 'msedge' })
 *
 * Regras obrigatórias da implementação (não valem para esta Etapa 9):
 *   - navegador = Microsoft Edge (`channel: 'msedge'`);
 *   - NÃO usar Chromium padrão, Firefox ou WebKit;
 *   - NÃO fazer fallback silencioso para Chromium;
 *   - se o Edge não estiver disponível, ERRO EXPLÍCITO (não silencioso);
 *   - verificar a disponibilidade do Edge em runtime — não assumir que existe.
 */
export interface BrowserCaseRunner {
  /**
   * Consulta um processo e devolve as movimentações cruas, ou `not_found`.
   * Erros de consulta são lançados como `CollectionError` (ver acima).
   */
  run(query: BrowserCaseQuery): Promise<BrowserCaseOutcome>;
}
