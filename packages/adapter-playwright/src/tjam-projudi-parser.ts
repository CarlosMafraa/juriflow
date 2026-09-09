/**
 * Parser da página de processo do PROJUDI Consulta Pública do TJAM.
 *
 * PURO: recebe o HTML como string, devolve dados estruturados. Nada de
 * navegador, Playwright ou rede — testável com fixtures.
 *
 * Contrato verificado em `docs/ACOMPANHAMENTO-TJAM-PROJUDI-SOURCE-CONTRACT.md`
 * e fixtures em `contracts/tjam/projudi/`.
 *
 * A página declara `<meta charset="ISO-8859-1">` mas os bytes são UTF-8 — quem
 * chama já passa a string decodificada como UTF-8 (o Playwright faz isso).
 */
import { parseHTML } from 'linkedom';

import type { BrowserMovement } from './browser-runner.js';

type LDDocument = ReturnType<typeof parseHTML>['document'];
type LDElement = NonNullable<ReturnType<LDDocument['querySelector']>>;

export interface TjamProjudiCodeLabel {
  readonly code: string | null;
  readonly label: string | null;
}

export interface TjamProjudiProcessInfo {
  /** Número CNJ mostrado no cabeçalho (`<h3> Processo <em class="attention">…</em>`). */
  readonly numero: string | null;
  readonly classe: TjamProjudiCodeLabel | null;
  readonly assunto: TjamProjudiCodeLabel | null;
  readonly comarca: string | null;
  readonly nivelSigilo: string | null;
}

export type TjamProjudiPageParse =
  | {
      readonly status: 'found';
      readonly processo: TjamProjudiProcessInfo;
      readonly movements: readonly BrowserMovement[];
    }
  | { readonly status: 'not_found' }
  | { readonly status: 'blocked'; readonly reason: 'waf' | 'recaptcha' }
  | { readonly status: 'unparseable'; readonly reason: string };

// `\s` do JS ja cobre NBSP e afins — um replace basta.
const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

const childrenTd = (el: LDElement | null | undefined): LDElement[] =>
  el ? (Array.from(el.children) as LDElement[]).filter((c) => c.tagName === 'TD') : [];

/** "NNN - Rótulo" → { code, label }. */
function splitCodeLabel(raw: string | null): TjamProjudiCodeLabel | null {
  const s = clean(raw);
  if (!s) return null;
  const m = /^(\S+)\s*-\s*(.+)$/.exec(s);
  return m ? { code: m[1], label: clean(m[2]) } : { code: null, label: s };
}

/**
 * "DD/MM/AAAA HH:MM:SS" (horário de Manaus, UTC-4, sem horário de verão) → ISO 8601.
 * Devolve `null` se não casar. O `dataRaw` original fica preservado em `raw`.
 */
export function tjamDateToISO(raw: string | null | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/.exec(clean(raw));
  if (!m) return null;
  const [, dd, mm, yyyy, HH = '00', MM = '00', SS = '00'] = m;
  const d = new Date(`${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}-04:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function readHeader(document: LDDocument): TjamProjudiProcessInfo {
  const numeroEl =
    document.querySelector('h3 em.attention') ?? document.querySelector('em.attention');
  const numero = numeroEl ? clean(numeroEl.textContent) || null : null;

  // `<table class="form">` : <td class="label"><label>Rótulo:</label></td><td>valor</td>
  const labelValue = (label: string): string | null => {
    for (const td of document.querySelectorAll('td.label, td.labelRadio')) {
      const el = td as LDElement;
      if (clean(el.textContent).replace(/:$/, '') === label) {
        const v = el.nextElementSibling;
        if (v) return clean(v.textContent);
      }
    }
    return null;
  };

  return {
    numero,
    classe: splitCodeLabel(
      clean(document.querySelector('a.definitionClasseProcessual')?.textContent) ||
        labelValue('Classe Processual'),
    ),
    assunto: splitCodeLabel(
      clean(document.querySelector('a.definitionAssuntoPrincipal')?.textContent) ||
        labelValue('Assunto Principal'),
    ),
    comarca: labelValue('Comarca'),
    nivelSigilo: (() => {
      const raw = labelValue('Nível de Sigilo') ?? '';
      const m = /^(P[úu]blico|Segredo de Justi[çc]a|Sigiloso|Restrito)/i.exec(raw);
      return m ? m[1] : raw.split(/\s{2,}|\bnew\b/)[0].trim() || null;
    })(),
  };
}

/** Extrai as linhas de `#idTableMovimentacoesmov1Grau1`. */
function readMovements(document: LDDocument): BrowserMovement[] {
  const table = document.querySelector('#idTableMovimentacoesmov1Grau1');
  if (!table) return [];

  const out: BrowserMovement[] = [];
  for (const trNode of table.querySelectorAll('tbody > tr')) {
    const tds = childrenTd(trNode as LDElement);
    if (tds.length < 4) continue;

    const seq = clean(tds[1]?.textContent);
    if (!/^\d+$/.test(seq)) continue;

    // td[0]: expansor de documento (presente só quando há documento anexo)
    const docEl = tds[0]?.querySelector(
      'a[class*="linkArquivosmovimentacoes"], img[id^="iconmovimentacoes"]',
    );
    const cdMatch = /(\d+)/.exec(
      `${docEl?.getAttribute('id') ?? ''} ${docEl?.getAttribute('class') ?? ''}`,
    );

    const dataRaw = clean(tds[2]?.textContent);

    // td[3]: <b>título</b> + <br> + complemento
    const eventoTd = tds[3];
    const b = eventoTd?.querySelector('b');
    const titulo = clean(b?.textContent) || clean(eventoTd?.textContent);
    let complemento = clean(eventoTd?.textContent);
    if (b) {
      complemento = clean(complemento.replace(clean(b.textContent), ''));
    }

    // td[4] ("Movimentado por") NÃO é coletado (contém nomes de pessoas).

    out.push({
      sourceMovementId: seq,
      occurredAt: tjamDateToISO(dataRaw),
      description: titulo,
      raw: {
        seq: Number(seq),
        dataRaw,
        titulo,
        complemento: complemento || null,
        temDocumento: docEl != null,
        cdDocumento: docEl != null && cdMatch ? cdMatch[1] : null,
      },
    });
  }
  return out;
}

export function parseTjamProjudiCasePage(html: string): TjamProjudiPageParse {
  const { document } = parseHTML(html);
  const bodyText = clean(document.body?.textContent) || clean(document.documentElement?.textContent);

  if (/Request Rejected/i.test(bodyText) || /Request Rejected/i.test(clean(document.title))) {
    return { status: 'blocked', reason: 'waf' };
  }

  if (document.querySelector('#idTableMovimentacoesmov1Grau1')) {
    return {
      status: 'found',
      processo: readHeader(document),
      movements: readMovements(document),
    };
  }

  if (/Nenhum registro encontrado/i.test(bodyText)) {
    return { status: 'not_found' };
  }

  // Formulário ainda na tela + reCAPTCHA não resolvido.
  if (document.querySelector('#pesquisar') && /recaptcha/i.test(html)) {
    return { status: 'blocked', reason: 'recaptcha' };
  }

  return {
    status: 'unparseable',
    reason:
      'sem #idTableMovimentacoesmov1Grau1, sem "Nenhum registro encontrado" e sem bloqueio conhecido',
  };
}
