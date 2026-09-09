import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseTjamProjudiCasePage, tjamDateToISO } from './tjam-projudi-parser.js';

const fixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../../contracts/tjam/projudi/${name}`, import.meta.url)),
    'utf8',
  );

describe('tjamDateToISO', () => {
  it('"DD/MM/AAAA HH:MM:SS" (Manaus UTC-4) → ISO UTC', () => {
    expect(tjamDateToISO('03/09/2026 11:51:37')).toBe('2026-09-03T15:51:37.000Z');
    expect(tjamDateToISO('01/09/2026 00:45:23 ')).toBe('2026-09-01T04:45:23.000Z');
  });
  it('só data, sem hora', () => {
    expect(tjamDateToISO('12/10/2025')).toBe('2025-10-12T04:00:00.000Z');
  });
  it('lixo → null', () => {
    expect(tjamDateToISO('')).toBeNull();
    expect(tjamDateToISO('ontem')).toBeNull();
  });
});

describe('parseTjamProjudiCasePage', () => {
  it('processo encontrado: cabeçalho + 6 movimentações da tabela real', () => {
    const r = parseTjamProjudiCasePage(fixture('processo_movimentacoes.skeleton.html'));
    expect(r.status).toBe('found');
    if (r.status !== 'found') return;

    expect(r.processo.numero).toBe('0000000-00.2025.8.04.1000');
    expect(r.processo.classe).toEqual({ code: '7', label: 'Procedimento Comum Cível' });
    expect(r.processo.assunto).toEqual({ code: '7621', label: 'Seguro' });
    expect(r.processo.comarca).toBe('Comarca de Teste');
    expect(r.processo.nivelSigilo).toBe('Público');

    expect(r.movements).toHaveLength(6);

    // 1ª linha (seq 69) — sem documento
    const m69 = r.movements[0];
    expect(m69?.sourceMovementId).toBe('69');
    expect(m69?.occurredAt).toBe('2026-09-03T15:51:37.000Z');
    expect(m69?.description).toBe('EXPEDIÇÃO DE INTIMAÇÃO');
    expect((m69?.raw as Record<string, unknown>).temDocumento).toBe(false);
    expect((m69?.raw as Record<string, unknown>).complemento).toMatch(/Aguardando publicação no DJEN/);

    // linha com documento anexo (seq 67)
    const m67 = r.movements.find((m) => m.sourceMovementId === '67');
    expect(m67?.description).toBe('DECISÃO INTERLOCUTÓRIA');
    expect((m67?.raw as Record<string, unknown>).temDocumento).toBe(true);
    expect((m67?.raw as Record<string, unknown>).cdDocumento).toBe('67');

    // "Movimentado por" (nomes de pessoas) NÃO aparece em lugar nenhum
    for (const m of r.movements) {
      expect(JSON.stringify(m)).not.toContain('SISTEMA PROJUDI');
      expect(JSON.stringify(m)).not.toContain('Magistrado');
    }
  });

  it('processo não encontrado', () => {
    expect(parseTjamProjudiCasePage(fixture('nao_encontrado.fragment.html')).status).toBe('not_found');
  });

  it('bloqueio do F5 WAF ("Request Rejected") → blocked/waf', () => {
    const r = parseTjamProjudiCasePage(fixture('request_rejected.fragment.html'));
    expect(r).toEqual({ status: 'blocked', reason: 'waf' });
  });

  it('HTML sem estrutura conhecida → unparseable', () => {
    expect(parseTjamProjudiCasePage('<html><body><p>outra coisa</p></body></html>').status).toBe(
      'unparseable',
    );
  });
});
