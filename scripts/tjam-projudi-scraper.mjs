/**
 * JuriFlow — robô de coleta da Consulta Pública do PROJUDI do TJAM.
 *
 * Fonte: https://projudi-consulta.tjam.jus.br/processo/consultaPublicaNova.do
 * (decisão de produto: DataJud está ~23 meses atrasado; o PROJUDI-web é a fonte).
 *
 * O host está atrás de F5 BIG-IP WAF + Google reCAPTCHA. Acesso headless é
 * bloqueado ("Request Rejected"). Este robô usa um NAVEGADOR REAL (Edge, canal
 * `msedge`) em modo HEADED, com perfil persistente para reaproveitar sessão
 * (JSESSIONID + cookies TS* do F5) entre execuções e reduzir desafios.
 *
 * NÃO resolve CAPTCHA. Se o reCAPTCHA exibir um desafio visível, o robô PAUSA e
 * aguarda o operador resolver na janela; se não houver operador, encerra com
 * outcome `recaptcha_challenge`.
 *
 * Responsabilidade: HTTP/browser + parsing -> movimentações estruturadas.
 * Hash / detecção / eventos / persistência continuam no collectorengine + worker.
 *
 * Uso:
 *   node scripts/tjam-projudi-scraper.mjs <CNJ> [--out arquivo.json] [--html pagina.html] \
 *        [--headless] [--timeout 180] [--profile <dir>]
 *
 * Saída (stdout, JSON):
 *   { cnj, outcome, collectedAt, url, processo:{...}|null, movimentacoes:[...] , partial }
 *   outcome ∈ found | not_found | segredo_justica | waf_blocked | recaptcha_challenge | error
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

const BASE = 'https://projudi-consulta.tjam.jus.br';
const START = `${BASE}/processo/consultaPublicaNova.do?actionType=iniciar`;

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0].startsWith('-')) {
  console.error('uso: node scripts/tjam-projudi-scraper.mjs <CNJ> [--out f.json] [--html p.html] [--headless] [--timeout 180] [--profile dir]');
  process.exit(2);
}
const cnjInput = argv[0];
const cnjDigits = cnjInput.replace(/\D/g, '');
if (cnjDigits.length !== 20) {
  console.error(`CNJ inválido: "${cnjInput}" (esperado 20 dígitos, veio ${cnjDigits.length})`);
  process.exit(2);
}
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);
const OUT = opt('out', null);
const HTML_OUT = opt('html', null);
const HEADLESS = flag('headless');
const TIMEOUT_S = Number(opt('timeout', '180'));
const PROFILE = opt('profile', path.join(REPO, '.cache', 'tjam-projudi-profile'));

// CNJ formatado NNNNNNN-DD.AAAA.J.TR.OOOO
const cnjFmt = `${cnjDigits.slice(0, 7)}-${cnjDigits.slice(7, 9)}.${cnjDigits.slice(9, 13)}.${cnjDigits.slice(13, 14)}.${cnjDigits.slice(14, 16)}.${cnjDigits.slice(16, 20)}`;

const log = (...a) => console.error('[projudi-scraper]', ...a);

// ---------------------------------------------------------------------------
// data helper — "DD/MM/AAAA HH:MM:SS" em America/Manaus (UTC-4, sem DST) -> ISO
// ---------------------------------------------------------------------------
function toISO(raw) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/.exec((raw || '').trim());
  if (!m) return null;
  const [, dd, mm, yyyy, HH = '00', MM = '00', SS = '00'] = m;
  const d = new Date(`${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}-04:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------------------------------------------------------------------------
async function main() {
  fs.mkdirSync(PROFILE, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: HEADLESS,
    channel: 'msedge',
    viewport: null,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  // timeout curto para operações de locator; o wait longo (F5) é explícito.
  page.setDefaultTimeout(20_000);

  const result = {
    cnj: cnjFmt,
    outcome: 'error',
    collectedAt: new Date().toISOString(),
    url: null,
    processo: null,
    movimentacoes: [],
    partial: false,
  };

  try {
    log('abrindo formulário…', START);
    await page.goto(START, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_S * 1000 });

    // F5 pode servir o desafio JS e recarregar; espera o campo real (ou bloqueio)
    const FIELD = '#numeroProcesso, input[name="numeroProcesso"]';
    const gotForm = await page
      .waitForSelector(FIELD, { state: 'visible', timeout: TIMEOUT_S * 1000 })
      .then(() => true)
      .catch(() => false);

    const bodyText = (await page.textContent('body').catch(() => '')) || '';
    if (!gotForm) {
      if (/Request Rejected/i.test(bodyText)) {
        result.outcome = 'waf_blocked';
        log('F5 ASM bloqueou o acesso ("Request Rejected"). Use IP residencial / navegador com operador.');
      } else {
        result.outcome = 'error';
        log('formulário não apareceu no tempo limite.');
      }
      return emit(result, ctx, page);
    }

    // preenche a busca por número único
    await page.selectOption('#cbPesquisa', 'NUMPROC').catch(() => {});
    const radioUnico = page.locator('input[name="flagNumeroUnico"][value="true"]');
    if (await radioUnico.count()) await radioUnico.check().catch(() => {});
    await page.fill(FIELD, cnjDigits);
    log('número preenchido:', cnjDigits);

    // reCAPTCHA: se houver um desafio VISÍVEL, pausa e aguarda o operador
    const challenge = page.frameLocator('iframe[src*="recaptcha"][src*="bframe"]').locator('body');
    const challengeVisible = await challenge
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    if (challengeVisible) {
      log('>>> reCAPTCHA exibiu um desafio. Resolva na janela do Edge. Aguardando até', TIMEOUT_S, 's…');
    }

    // submete e espera QUALQUER um: tabela de movimentações, "nenhum registro",
    // bloqueio do F5, ou o próprio form continuar na tela (reCAPTCHA travou).
    await page.click('#pesquisar').catch(() => page.press(FIELD, 'Enter'));
    await page
      .waitForSelector(
        '#idTableMovimentacoesmov1Grau1, #mensagemRetorno, td[id="mensagemRetorno"]',
        { timeout: Math.min(TIMEOUT_S, 90) * 1000 },
      )
      .catch(() => null);
    await page.waitForTimeout(1500);
    result.url = page.url();

    // classifica o resultado
    const bt = (await page.textContent('body', { timeout: 5000 }).catch(() => '')) || '';
    if (/Request Rejected/i.test(bt)) {
      result.outcome = 'waf_blocked';
      return emit(result, ctx, page);
    }
    const hasMovTable = await page.locator('#idTableMovimentacoesmov1Grau1').count();
    const noRecords = /Nenhum registro encontrado|N[ãa]o (foram|existem) (encontrado|informa)/i.test(bt);
    const stillOnForm = (await page.locator('#pesquisar').count()) > 0 && !hasMovTable;

    if (!hasMovTable && noRecords) {
      result.outcome = 'not_found';
      return emit(result, ctx, page);
    }
    if (stillOnForm && /recaptcha/i.test(bt)) {
      result.outcome = 'recaptcha_challenge';
      log('a busca não avançou — provável reCAPTCHA não resolvido pelo modo automatizado.');
      return emit(result, ctx, page);
    }

    // cabeçalho + sigilo + movimentações (parsing no DOM)
    const parsed = await page.evaluate(() => {
      const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
      const near = (label) => {
        const tds = [...document.querySelectorAll('td.label, td.labelRadio')];
        for (const td of tds) {
          if (td.textContent.replace(/\s+/g, ' ').trim().replace(/:$/, '') === label) {
            const v = td.nextElementSibling;
            if (v) return v.textContent.replace(/\s+/g, ' ').trim();
          }
        }
        return null;
      };
      const codeLabel = (s) => {
        if (!s) return { code: null, label: null };
        const m = /^\s*(\S+)\s*-\s*(.+)$/.exec(s);
        return m ? { code: m[1], label: m[2].trim() } : { code: null, label: s };
      };

      // "Nível de Sigilo": a celula tras um <script> de tooltip junto; fica so a 1a palavra util
      const rawSigilo = near('Nível de Sigilo') || '';
      const nivelSigilo = (rawSigilo.match(/^\s*(P[úu]blico|Segredo de Justi[çc]a|Sigiloso|Restrito)/i) || [null, rawSigilo.split(/\s{2,}|\bnew\b/)[0].trim()])[1] || null;
      // numero do processo: no detalhe vem no <h3> "Processo NNNNNNN-DD.AAAA.J.TR.OOOO"
      const numero = (document.body.textContent.match(/Processo\s+(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})/) || [])[1] || null;
      const proc = {
        numero,
        classe: codeLabel(txt(document.querySelector('a.definitionClasseProcessual')) || near('Classe Processual')),
        assunto: codeLabel(txt(document.querySelector('a.definitionAssuntoPrincipal')) || near('Assunto Principal')),
        comarca: near('Comarca'),
        competencia: near('Competência'),
        autuacao: near('Autuação'),
        distribuicao: near('Distribuição'),
        nivelSigilo,
        emTramitacaoDias: (() => {
          const m = /(\d+)\s*dia\(s\)\s*em\s*tramita/i.exec(document.body.textContent);
          return m ? Number(m[1]) : null;
        })(),
      };

      const table = document.querySelector('#idTableMovimentacoesmov1Grau1');
      const movs = [];
      if (table) {
        for (const tr of table.querySelectorAll('tbody > tr')) {
          const tds = tr.querySelectorAll(':scope > td');
          if (tds.length < 4) continue;
          const seqRaw = txt(tds[1]);
          const seq = seqRaw && /^\d+$/.test(seqRaw) ? Number(seqRaw) : null;
          if (seq === null) continue;

          const docLink = tds[0].querySelector('a[class*="linkArquivosmovimentacoes"], img[id^="iconmovimentacoes"]');
          let cdDocumento = null;
          if (docLink) {
            const idAttr = docLink.id || (docLink.className.match(/linkArquivosmovimentacoes(\d+)/) || [])[0] || '';
            const md = /(\d+)/.exec(idAttr);
            cdDocumento = md ? md[1] : null;
          }

          const cell = tds[3];
          const b = cell.querySelector('b');
          const titulo = b ? b.textContent.replace(/\s+/g, ' ').trim() : cell.textContent.replace(/\s+/g, ' ').trim();
          // complemento = texto do <td> menos o texto do <b>
          let complemento = cell.textContent.replace(/\s+/g, ' ').trim();
          if (b) complemento = complemento.replace(b.textContent.replace(/\s+/g, ' ').trim(), '').trim();

          movs.push({
            seq,
            dataRaw: txt(tds[2]),
            titulo,
            complemento: complemento || null,
            temDocumento: !!docLink,
            cdDocumento,
          });
        }
      }
      return { proc, movs, hasSenhaPopup: !!document.querySelector('#popupSenhaProcesso, #senhaProcesso') };
    });

    if ((parsed.proc.nivelSigilo && !/p[úu]blico/i.test(parsed.proc.nivelSigilo)) || parsed.hasSenhaPopup) {
      result.outcome = 'segredo_justica';
      result.processo = parsed.proc;
      return emit(result, ctx, page);
    }
    if (!hasMovTable) {
      result.outcome = 'error';
      log('sem tabela de movimentações e sem mensagem conhecida — layout mudou?');
      return emit(result, ctx, page);
    }

    result.outcome = 'found';
    result.processo = parsed.proc;
    result.movimentacoes = parsed.movs
      .map((m) => ({ ...m, dataISO: toISO(m.dataRaw), sourceMovementId: String(m.seq) }))
      .sort((a, b) => a.seq - b.seq); // ordem cronológica ascendente

    if (HTML_OUT) {
      fs.writeFileSync(path.resolve(HTML_OUT), await page.content(), 'utf8');
      log('HTML salvo em', HTML_OUT);
    }
    return emit(result, ctx, page);
  } catch (err) {
    result.outcome = 'error';
    result.error = String(err && err.message ? err.message : err);
    log('erro:', result.error);
    return emit(result, ctx, page);
  }
}

async function emit(result, ctx, page) {
  try { await ctx.close(); } catch {}
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.outcome === 'found' && OUT) {
    fs.writeFileSync(path.resolve(OUT), JSON.stringify(result, null, 2), 'utf8');
    log('resultado salvo em', OUT, `(${result.movimentacoes.length} movimentações)`);
  }
  process.exit(result.outcome === 'found' || result.outcome === 'not_found' ? 0 : 1);
}

main();
