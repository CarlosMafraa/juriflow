import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseBrDate, readMovementTable } from './tjam-projudi.adapter.js';

/**
 * Mesma estrutura HTML da aba "Movimentações" da consulta pública do TJAM
 * (conferida no site em 2026-09-26), com partes e servidores FICTÍCIOS — dado
 * pessoal real de processo não entra no repositório.
 */
const PAGE = `
<table class="resultTable" id="idTableMovimentacoesmov1Grau1">
  <thead><tr><th></th><th>Seq.</th><th>Data</th><th>Evento</th><th>Movimentado por</th></tr></thead>
  <tbody>
  <tr class="even" id="mov1GrauOUTROS,,,,,">
    <td>&nbsp;</td><td>70 </td><td>08/09/2026 10:41:19 </td>
    <td> <b>ALVARÁ ENVIADO </b> <br>Alvará número 000000000000 enviado em 08/09/2026 às 10:41:19 pelo usuário servidor.ficticio </td>
    <td> <img style="display: none">&nbsp;SISTEMA PROJUDI </td>
  </tr>
  <tr class="odd" id="mov1GrauOUTROS,,SEMARQUIVO,,,">
    <td>&nbsp;</td><td>69 </td><td>03/09/2026 11:51:37 </td>
    <td> <b>EXPEDIÇÃO DE INTIMAÇÃO </b> <br>Para advogados/curador/defensor de FULANO DE TAL com prazo de 15 dias úteis - Aguardando publicação no DJEN </td>
    <td>&nbsp;SISTEMA PROJUDI </td>
  </tr>
  <tr class="odd" id="mov1GrauJUIZ,,,,,">
    <td><a class="linkArquivosmovimentacoes67"><img id="iconmovimentacoes67"></a></td>
    <td>67 </td><td>03/09/2026 11:51:36 </td>
    <td> <b>DECISÃO INTERLOCUTÓRIA </b> </td>
    <td>&nbsp;Juiz Fictício <br>&nbsp;<font size="1"><b>Magistrado</b></font></td>
  </tr>
  <tr id="rowmovimentacoes67" style="display:none"><td colspan="5"><div id="divArquivosMovimentacaoProcessomovimentacoes67"><b>arquivo.pdf</b></div></td></tr>
  <tr class="even" id="mov1GrauOUTROS,,SEMARQUIVO,,,">
    <td>&nbsp;</td><td>61 </td><td>02/08/2026 10:05:11 </td>
    <td> <b>DISPONIBILIZAÇÃO NO DIÁRIO DA JUSTIÇA ELETRÔNICO </b> <br><b>Data de Disponibilização:</b> 29/07/2026<br><b>Prazo:</b> 15 dias úteis<br>Para advogados de: FULANO DE TAL </td>
    <td>&nbsp;SISTEMA PROJUDI </td>
  </tr>
  </tbody>
</table>`;

describe('readMovementTable (estrutura da consulta pública do TJAM)', () => {
  let browser: Browser | undefined;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    // Se o navegador nem abriu, o erro que importa é o do beforeAll.
    await browser?.close();
  });

  async function read(): Promise<Awaited<ReturnType<typeof readMovementTable>>> {
    if (!browser) throw new Error('Chromium não abriu (npx playwright install chromium).');
    const page = await browser.newPage();
    await page.setContent(PAGE);
    try {
      return await readMovementTable(page);
    } finally {
      await page.close();
    }
  }

  it('lê uma movimentação por linha, ignorando o painel de arquivos', async () => {
    const movements = await read();
    expect(movements.map((m) => m.sourceMovementId)).toEqual(['1:70', '1:69', '1:67', '1:61']);
  });

  it('separa o tipo (título em negrito) do detalhe', async () => {
    const [alvara, intimacao, decisao, dje] = await read();
    expect(alvara.title).toBe('ALVARÁ ENVIADO');
    expect(alvara.description).toBe(
      'ALVARÁ ENVIADO\nAlvará número 000000000000 enviado em 08/09/2026 às 10:41:19 pelo usuário servidor.ficticio',
    );
    expect(intimacao.title).toBe('EXPEDIÇÃO DE INTIMAÇÃO');
    expect(decisao.title).toBe('DECISÃO INTERLOCUTÓRIA');
    expect(decisao.description).toBe('DECISÃO INTERLOCUTÓRIA');
    expect(dje.title).toBe('DISPONIBILIZAÇÃO NO DIÁRIO DA JUSTIÇA ELETRÔNICO');
    expect(dje.description).toContain('Prazo: 15 dias úteis');
  });

  it('data com segundos, no fuso de Manaus', async () => {
    const [alvara] = await read();
    expect(alvara.occurredAt).toBe('2026-09-08T14:41:19.000Z');
    expect(parseBrDate('31/10/2025')).toBe('2025-10-31T04:00:00.000Z');
    expect(parseBrDate('sem data')).toBeNull();
  });
});
