/**
 * Ferramenta manual para validar/ajustar `tjam-projudi.selectors.ts` contra o
 * DOM real — necessário porque a consulta pública fica atrás de um desafio
 * anti-bot que só um browser real resolve (curl não passa disso).
 *
 * Uso:
 *   npm run inspect --workspace @juriflow/scraper-worker -- <numero-do-processo-CNJ>
 *
 * Abre um Chromium HEADFUL, navega até a consulta pública, tenta preencher e
 * pesquisar com os seletores atuais, e mantém o browser aberto (Playwright
 * Inspector) para você confirmar/corrigir os seletores manualmente.
 */
/* eslint-disable no-console -- ferramenta de linha de comando, saída é o propósito do script. */
import { chromium } from 'playwright';
import { TJAM_PROJUDI_SELECTORS as SEL } from '../src/adapters/tjam-projudi.selectors.js';

const DEFAULT_BASE_URL =
  'https://projudi-consulta.tjam.jus.br/processo/consultaPublicaNova.do?actionType=iniciar';

async function main(): Promise<void> {
  const cnjNumber = process.argv[2];
  if (!cnjNumber) {
    console.error('Uso: npm run inspect --workspace @juriflow/scraper-worker -- <numero-CNJ>');
    process.exit(1);
  }

  const baseUrl = process.env['TJAM_PROJUDI_BASE_URL'] ?? DEFAULT_BASE_URL;
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log(`Abrindo ${baseUrl} ...`);
  await page.goto(baseUrl, { waitUntil: 'networkidle' });

  const found = await page
    .waitForSelector(SEL.processNumberInput, { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);

  if (!found) {
    console.warn(
      `Seletor "${SEL.processNumberInput}" não encontrado. Inspecione a página aberta ` +
        'e atualize src/adapters/tjam-projudi.selectors.ts.',
    );
  } else {
    console.log('Campo de número do processo encontrado — preenchendo e pesquisando...');
    await page.fill(SEL.processNumberInput, cnjNumber);
    await page
      .click(SEL.searchButton)
      .catch((e) => console.warn('Falha ao clicar em searchButton:', e));
  }

  console.log('Browser aberto para inspeção manual. Feche a janela quando terminar.');
  await new Promise(() => {}); // mantém o processo vivo até fechar manualmente
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
