/// <reference lib="dom" />
import { chromium, type Browser, type BrowserContext } from 'playwright';
import type {
  ProcessDataSource,
  RawMovement,
  SourceFetchInput,
  SourceFetchResult,
  SourceTarget,
} from '@juriflow/collectors-core';
import type { Logger } from '../infra/logger.js';
import { TJAM_PROJUDI_SELECTORS as SEL } from './tjam-projudi.selectors.js';

/**
 * Regra do produto (docs/REGRAS-DE-NEGOCIO.md, F1): a ÚNICA fonte de dados é
 * a consulta pública do Projudi/TJAM, neste endereço. Fixo no código — não é
 * configurável por variável de ambiente, para ninguém apontar a coleta para
 * outro site (nem para o Projudi com login).
 */
export const TJAM_PUBLIC_CONSULTATION_URL =
  'https://projudi-consulta.tjam.jus.br/processo/consultaPublicaNova.do?actionType=iniciar';

export interface TjamProjudiAdapterOptions {
  /**
   * O firewall do TJAM (F5) responde "Request Rejected" a navegador headless;
   * em produção roda com janela sob Xvfb (ver Dockerfile). Só use `true` para
   * testar a extração contra HTML salvo.
   */
  readonly headless: boolean;
  readonly logger: Logger;
}

/** Linha da tabela como lida do DOM, antes de virar `RawMovement`. */
interface MovementRowData {
  readonly rowId: string;
  readonly seq: string;
  readonly dateText: string;
  readonly title: string;
  readonly detail: string;
  readonly movedBy: string;
}

/**
 * Adapter concreto do Projudi/TJAM (`ProcessDataSource`). É o ÚNICO lugar do
 * sistema que sabe que existe um "Projudi" ou um "TJAM" (ADR-0004) — o
 * pipeline (TrackProcessUseCase) só conhece a porta.
 *
 * A fonte fica atrás de um desafio anti-bot (F5 TSPD, JS-only). Um browser
 * real com janela resolve isso sozinho ao carregar a página; por isso usamos
 * Playwright em vez de HTTP puro, sem user-agent inventado (a divergência entre
 * UA e navegador real também é sinal de robô).
 */
export class TjamProjudiAdapter implements ProcessDataSource {
  readonly kind = 'projudi_tjam' as const;

  private browser: Browser | null = null;

  constructor(private readonly options: TjamProjudiAdapterOptions) {}

  canHandle(target: SourceTarget): boolean {
    return target.cnjNumber !== null;
  }

  async fetch(input: SourceFetchInput): Promise<SourceFetchResult> {
    const cnjNumber = input.target.cnjNumber;
    if (!cnjNumber) {
      throw new Error('TjamProjudiAdapter requer cnjNumber — processo sem CNJ não é rastreável.');
    }

    const context = await this.ensureContext();
    const page = await context.newPage();
    try {
      await this.openSearchForm(page);
      await this.submitProcessNumber(page, cnjNumber);
      const movements = await this.extractMovements(page, cnjNumber);

      return {
        sourceKind: this.kind,
        collectedAt: new Date().toISOString(),
        movements,
      };
    } catch (error) {
      // Sessão possivelmente marcada pelo firewall: a próxima consulta recomeça do zero.
      await this.resetContext();
      throw error;
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async dispose(): Promise<void> {
    await this.resetContext();
    await this.browser?.close();
    this.browser = null;
  }

  /**
   * Uma sessão de navegador reaproveitada entre consultas (cookies do desafio
   * do firewall incluídos), como alguém com a aba aberta. Abrir um navegador
   * "zerado" a cada processo força um desafio novo toda vez — padrão de robô
   * que faz o F5 do TJAM responder "Request Rejected".
   */
  private context: BrowserContext | null = null;

  private async ensureContext(): Promise<BrowserContext> {
    if (!this.context) {
      const browser = await this.ensureBrowser();
      this.context = await browser.newContext({
        viewport: { width: 1366, height: 900 },
        locale: 'pt-BR',
        timezoneId: 'America/Manaus',
      });
    }
    return this.context;
  }

  private async resetContext(): Promise<void> {
    await this.context?.close().catch(() => undefined);
    this.context = null;
  }

  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: this.options.headless,
        args: ['--disable-blink-features=AutomationControlled'],
      });
    }
    return this.browser;
  }

  /** Abre a consulta pública e aguarda o desafio anti-bot resolver (se houver). */
  private async openSearchForm(page: import('playwright').Page): Promise<void> {
    await page.goto(TJAM_PUBLIC_CONSULTATION_URL, { waitUntil: 'networkidle' });

    const formReady = await page
      .waitForSelector(SEL.processNumberInput, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);

    if (!formReady) {
      const title = await page.title().catch(() => '');
      this.options.logger.warn(
        'Formulário do Projudi não apareceu no 1º carregamento — tentando recarregar.',
        {
          title,
        },
      );
      await page.reload({ waitUntil: 'networkidle' });
      const ready = await page
        .waitForSelector(SEL.processNumberInput, { timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!ready) {
        throw new Error(
          `Consulta pública do TJAM indisponível ou bloqueada (página: "${await page.title().catch(() => '')}").`,
        );
      }
    }
  }

  private async submitProcessNumber(
    page: import('playwright').Page,
    cnjNumber: string,
  ): Promise<void> {
    await page.fill(SEL.processNumberInput, cnjNumber);
    // Espera a NAVEGAÇÃO do resultado. `waitForLoadState` sozinho resolvia na
    // hora (a página do formulário já estava ociosa) e a tabela era procurada
    // antes de o resultado chegar.
    await Promise.all([
      page.waitForURL(SEL.resultUrl, { timeout: 45_000, waitUntil: 'domcontentloaded' }),
      page.click(SEL.searchButton),
    ]);
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  }

  private async extractMovements(
    page: import('playwright').Page,
    cnjNumber: string,
  ): Promise<RawMovement[]> {
    const hasTable = await page
      .waitForSelector(SEL.movementsTable, { timeout: 30_000, state: 'attached' })
      .then(() => true)
      .catch(() => false);

    if (!hasTable) {
      const bodyText = ((await page.textContent('body').catch(() => '')) ?? '').toLowerCase();
      if (bodyText.includes(SEL.notFoundText)) {
        this.options.logger.warn('Processo não localizado no Projudi/TJAM.', { cnjNumber });
        return [];
      }
      // Só título e caminho: o corpo da página tem nome de parte (fica fora do log/erro).
      const title = await page.title().catch(() => '');
      const path = new URL(page.url()).pathname;
      throw new Error(
        `Tabela de movimentações não encontrada na consulta pública do TJAM (página "${title}", ${path}).`,
      );
    }

    return readMovementTable(page);
  }
}

/**
 * Lê a tabela de movimentações já carregada na página. Exportada para ser
 * testada contra HTML com a mesma estrutura do site, sem acessar o TJAM.
 */
export async function readMovementTable(page: import('playwright').Page): Promise<RawMovement[]> {
  const rows: MovementRowData[] = await page.$$eval(
    `${SEL.movementsTable} ${SEL.movementRow}`,
    (trs) =>
      trs.map((tr) => {
        // Sem funções nomeadas aqui dentro: o código roda no navegador e o
        // tsx (dev) injeta um helper `__name` que lá não existe.
        const cells = Array.from(tr.querySelectorAll(':scope > td')).map((td) =>
          (td.textContent ?? '').replace(/\s+/g, ' ').trim(),
        );
        const evento = tr.querySelectorAll(':scope > td')[3];
        const bold = evento?.querySelector('b');
        const title = (bold?.textContent ?? '').replace(/\s+/g, ' ').trim();
        // Evento = "<b>TÍTULO</b><br>detalhe…": a 1ª linha renderizada é o título.
        const lines = ((evento as HTMLElement | undefined)?.innerText ?? '')
          .split('\n')
          .map((l) => l.replace(/\s+/g, ' ').trim())
          .filter(Boolean);
        if (lines[0] === title) lines.shift();
        const detail = lines.join('\n');
        return {
          rowId: tr.id,
          seq: cells[1] ?? '',
          dateText: cells[2] ?? '',
          title,
          detail,
          movedBy: cells[4] ?? '',
        };
      }),
  );

  const movements: RawMovement[] = [];
  for (const row of rows) {
    if (!row.title || !/^\d+$/.test(row.seq)) continue;
    const grau = row.rowId.match(/^mov(\d+)Grau/)?.[1] ?? '1';
    movements.push({
      sourceKind: 'projudi_tjam',
      // Seq. é única e estável dentro do grau: base da deduplicação (RN16).
      sourceMovementId: `${grau}:${row.seq}`,
      occurredAt: parseBrDate(row.dateText),
      title: row.title,
      description: row.detail ? `${row.title}\n${row.detail}` : row.title,
      raw: { grau, seq: Number(row.seq), dateText: row.dateText, movedBy: row.movedBy },
    });
  }
  return movements;
}

/** Converte "dd/mm/aaaa" ou "dd/mm/aaaa hh:mm[:ss]" (padrão dos tribunais BR) para ISO 8601. */
export function parseBrDate(text: string): string | null {
  const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return null;
  const [, day, month, year, hour = '00', minute = '00', second = '00'] = match;
  const iso = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}-04:00`); // America/Manaus (UTC-4)
  return Number.isNaN(iso.getTime()) ? null : iso.toISOString();
}
