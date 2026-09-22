import { chromium, type Browser } from 'playwright';
import type {
  ProcessDataSource,
  RawMovement,
  SourceFetchInput,
  SourceFetchResult,
  SourceTarget,
} from '@juriflow/collectors-core';
import type { Logger } from '../infra/logger.js';
import { TJAM_PROJUDI_SELECTORS as SEL } from './tjam-projudi.selectors.js';

const REALISTIC_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface TjamProjudiAdapterOptions {
  readonly baseUrl: string;
  readonly headless: boolean;
  readonly logger: Logger;
}

/**
 * Adapter concreto do Projudi/TJAM (`ProcessDataSource`). É o ÚNICO lugar do
 * sistema que sabe que existe um "Projudi" ou um "TJAM" (ADR-0004) — o
 * pipeline (TrackProcessUseCase) só conhece a porta.
 *
 * A fonte fica atrás de um desafio anti-bot (F5/Distil, JS-only, sem captcha
 * confirmado no fluxo manual). Um browser real normalmente resolve isso sozinho
 * ao carregar a página; por isso usamos Playwright em vez de HTTP puro.
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

    const browser = await this.ensureBrowser();
    const context = await browser.newContext({
      userAgent: REALISTIC_USER_AGENT,
      viewport: { width: 1366, height: 900 },
      locale: 'pt-BR',
    });

    try {
      const page = await context.newPage();
      await this.openSearchForm(page);
      await this.submitProcessNumber(page, cnjNumber);
      const movements = await this.extractMovements(page, cnjNumber);

      return {
        sourceKind: this.kind,
        collectedAt: new Date().toISOString(),
        movements,
      };
    } finally {
      await context.close();
    }
  }

  async dispose(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }

  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: this.options.headless });
    }
    return this.browser;
  }

  /** Abre a consulta pública e aguarda o desafio anti-bot resolver (se houver). */
  private async openSearchForm(page: import('playwright').Page): Promise<void> {
    await page.goto(this.options.baseUrl, { waitUntil: 'networkidle' });

    const formReady = await page
      .waitForSelector(SEL.processNumberInput, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);

    if (!formReady) {
      this.options.logger.warn(
        'Formulário do Projudi não apareceu no 1º carregamento — tentando recarregar.',
      );
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector(SEL.processNumberInput, { timeout: 15_000 });
    }
  }

  private async submitProcessNumber(
    page: import('playwright').Page,
    cnjNumber: string,
  ): Promise<void> {
    await page.fill(SEL.processNumberInput, cnjNumber);
    await Promise.all([page.waitForLoadState('networkidle'), page.click(SEL.searchButton)]);
  }

  private async extractMovements(
    page: import('playwright').Page,
    cnjNumber: string,
  ): Promise<RawMovement[]> {
    const bodyText = await page.textContent('body').catch(() => '');
    if (bodyText && bodyText.toLowerCase().includes(SEL.notFoundText)) {
      this.options.logger.warn('Processo não localizado no Projudi/TJAM.', { cnjNumber });
      return [];
    }

    const container = page.locator(SEL.movementsContainer).first();
    const hasContainer = await container.count().then((n) => n > 0);
    if (!hasContainer) {
      this.options.logger.warn('Container de movimentações não encontrado — verificar seletores.', {
        cnjNumber,
      });
      return [];
    }

    const rows = container.locator(SEL.movementRow);
    const rowCount = await rows.count();
    const movements: RawMovement[] = [];

    for (let i = 0; i < rowCount; i += 1) {
      const row = rows.nth(i);
      const dateText = await row
        .locator(SEL.movementDateCell)
        .innerText()
        .catch(() => '');
      const descriptionText = await row
        .locator(SEL.movementDescriptionCell)
        .innerText()
        .catch(() => '');
      const description = descriptionText.trim();
      if (!description) continue; // linha de cabeçalho ou vazia

      const rowHtml = await row.innerHTML().catch(() => '');
      movements.push({
        sourceKind: this.kind,
        sourceMovementId: null,
        occurredAt: parseBrDate(dateText.trim()),
        description,
        raw: { dateText: dateText.trim(), descriptionText: description, html: rowHtml },
      });
    }

    return movements;
  }
}

/** Converte "dd/mm/aaaa" ou "dd/mm/aaaa hh:mm" (padrão dos tribunais BR) para ISO 8601. */
function parseBrDate(text: string): string | null {
  const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!match) return null;
  const [, day, month, year, hour = '00', minute = '00'] = match;
  const iso = new Date(`${year}-${month}-${day}T${hour}:${minute}:00-04:00`); // America/Manaus (UTC-4)
  return Number.isNaN(iso.getTime()) ? null : iso.toISOString();
}
