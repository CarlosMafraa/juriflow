/**
 * `TjamProjudiEdgeRunner` — implementação concreta do `BrowserCaseRunner`
 * (Etapa 9) usando **Playwright + Microsoft Edge**.
 *
 *   CNJ → Playwright.launch({ channel: 'msedge' }) → navega no PROJUDI Consulta
 *   Pública do TJAM → localiza o processo → extrai as movimentações →
 *   devolve `BrowserCaseOutcome`.
 *
 * Regras (Etapa 10):
 *   - navegador SEMPRE Microsoft Edge (`channel: 'msedge'`); nunca Chromium
 *     padrão, Firefox ou WebKit; sem fallback silencioso;
 *   - se o Edge não estiver disponível, erro EXPLÍCITO;
 *   - o ciclo de vida do navegador é fechado sempre (inclusive em erro).
 *
 * NÃO persiste, NÃO detecta mudança, NÃO agenda nada.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { CollectionError, CollectionParseError, CollectionTimeoutError, CollectionUnavailableError } from '@juriflow/collector-engine';

import type { BrowserCaseOutcome, BrowserCaseQuery, BrowserCaseRunner } from './browser-runner.js';
import { parseTjamProjudiCasePage } from './tjam-projudi-parser.js';

/** URL/fluxo do TJAM ficam FIXOS aqui (decisão do MVP — sem consulta a `courts`). */
const TJAM_PROJUDI_FORM_URL =
  'https://projudi-consulta.tjam.jus.br/processo/consultaPublicaNova.do?actionType=iniciar';

export interface TjamProjudiEdgeRunnerOptions {
  /**
   * `false` (default) = janela visível. O F5/WAF do PROJUDI bloqueia acesso
   * headless ("Request Rejected"); headless só serve para diagnóstico.
   */
  readonly headless?: boolean;
  /** Timeout por passo (navegação, espera de elemento), em ms. Default: 60000. */
  readonly timeoutMs?: number;
  /**
   * Diretório de perfil persistente do Edge. Reaproveita a sessão do F5 entre
   * execuções e reduz desafios. Se omitido, usa contexto efêmero.
   */
  readonly userDataDir?: string;
}

const onlyDigits = (s: string): string => s.replace(/\D+/g, '');

export class TjamProjudiEdgeRunner implements BrowserCaseRunner {
  private readonly headless: boolean;
  private readonly timeoutMs: number;
  private readonly userDataDir: string | undefined;

  constructor(options: TjamProjudiEdgeRunnerOptions = {}) {
    this.headless = options.headless ?? false;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.userDataDir = options.userDataDir;
  }

  async run(query: BrowserCaseQuery): Promise<BrowserCaseOutcome> {
    const cnj = onlyDigits(query.cnjNumber);
    if (cnj.length !== 20) {
      throw new CollectionParseError(
        `Número CNJ inválido para consulta: "${query.cnjNumber}" (esperado 20 dígitos).`,
      );
    }

    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    let page: Page | undefined;

    try {
      // 1. Microsoft Edge via Playwright — canal 'msedge', sem fallback.
      ({ browser, context } = await this.launchEdge());
      page = await context.newPage();
      page.setDefaultTimeout(this.timeoutMs);

      // 2. abre o formulário (o F5 pode servir um desafio JS e recarregar).
      await page.goto(TJAM_PROJUDI_FORM_URL, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeoutMs,
      });

      const FIELD = '#numeroProcesso, input[name="numeroProcesso"]';
      const formOk = await page
        .waitForSelector(FIELD, { state: 'visible', timeout: this.timeoutMs })
        .then(() => true)
        .catch(() => false);

      if (!formOk) {
        const body = (await page.textContent('body', { timeout: 5_000 }).catch(() => '')) ?? '';
        if (/Request Rejected/i.test(body)) {
          throw new CollectionUnavailableError(
            'PROJUDI/TJAM bloqueou o acesso (F5 WAF "Request Rejected"). ' +
              'Automatização exige navegador com IP residencial / janela visível.',
          );
        }
        throw new CollectionParseError('O formulário de consulta do PROJUDI não carregou.');
      }

      // 3. preenche a busca por número único.
      await page.selectOption('#cbPesquisa', 'NUMPROC').catch(() => undefined);
      const radioUnico = page.locator('input[name="flagNumeroUnico"][value="true"]');
      if ((await radioUnico.count()) > 0) {
        await radioUnico.check().catch(() => undefined);
      }
      await page.fill(FIELD, cnj);

      // 4. submete e espera a página do processo, ou o "nenhum registro".
      await page.click('#pesquisar').catch(() => page?.press(FIELD, 'Enter'));
      await page
        .waitForSelector('#idTableMovimentacoesmov1Grau1, #mensagemRetorno, td[id="mensagemRetorno"]', {
          timeout: this.timeoutMs,
        })
        .catch(() => undefined);
      await page.waitForTimeout(1_000);

      // 5. lê o HTML e delega ao parser puro.
      const html = await page.content();
      const parsed = parseTjamProjudiCasePage(html);

      switch (parsed.status) {
        case 'not_found':
          return { status: 'not_found' };

        case 'blocked':
          if (parsed.reason === 'recaptcha') {
            throw new CollectionUnavailableError(
              'PROJUDI/TJAM exibiu um desafio reCAPTCHA — a automação não resolve captcha.',
            );
          }
          throw new CollectionUnavailableError(
            'PROJUDI/TJAM bloqueou o acesso (F5 WAF) na etapa de resultado.',
          );

        case 'unparseable':
          throw new CollectionParseError(`Página de resultado do PROJUDI inesperada: ${parsed.reason}.`);

        case 'found': {
          const numeroPagina = parsed.processo.numero ? onlyDigits(parsed.processo.numero) : null;
          if (numeroPagina !== null && numeroPagina !== cnj) {
            throw new CollectionParseError(
              `A página retornou o processo ${parsed.processo.numero}, diferente do consultado.`,
            );
          }
          return { status: 'found', movements: parsed.movements };
        }
      }

      // inalcançável — o switch acima é exaustivo.
      throw new CollectionParseError('Estado de parse do PROJUDI não tratado.');
    } catch (err) {
      throw this.toCollectionError(err);
    } finally {
      // 6. ciclo de vida — fecha tudo, mesmo em erro.
      await page?.close().catch(() => undefined);
      await context?.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);
    }
  }

  private async launchEdge(): Promise<{ browser?: Browser; context: BrowserContext }> {
    try {
      if (this.userDataDir !== undefined) {
        // contexto persistente: `browser` não é exposto separadamente.
        const context = await chromium.launchPersistentContext(this.userDataDir, {
          channel: 'msedge',
          headless: this.headless,
          args: ['--disable-blink-features=AutomationControlled'],
          ignoreDefaultArgs: ['--enable-automation'],
        });
        return { context };
      }
      const browser = await chromium.launch({
        channel: 'msedge',
        headless: this.headless,
        args: ['--disable-blink-features=AutomationControlled'],
        ignoreDefaultArgs: ['--enable-automation'],
      });
      const context = await browser.newContext();
      return { browser, context };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Sem fallback para Chromium — erro explícito.
      throw new CollectionError(
        'unknown',
        `Microsoft Edge (channel "msedge") não está disponível para o Playwright: ${msg}. ` +
          'Instale o Microsoft Edge. Não há fallback para outro navegador.',
        false,
      );
    }
  }

  private toCollectionError(err: unknown): CollectionError {
    if (err instanceof CollectionError) return err;
    const name = (err as { name?: string } | null)?.name;
    const msg = err instanceof Error ? err.message : String(err);
    if (name === 'TimeoutError') {
      return new CollectionTimeoutError(`Tempo limite ao consultar o PROJUDI/TJAM: ${msg}`);
    }
    return new CollectionError('unknown', `Falha ao consultar o PROJUDI/TJAM: ${msg}`, false);
  }
}
