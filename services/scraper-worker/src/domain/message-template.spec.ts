import { describe, expect, it } from 'vitest';
import {
  chunkForDigest,
  GeneralMovementTemplate,
  PlaceholderMovementTemplate,
} from './message-template.js';

describe('GeneralMovementTemplate', () => {
  it('inclui número do processo, data formatada e descrição da movimentação', () => {
    const template = new GeneralMovementTemplate();
    const message = template.render({
      cnjNumber: '0000001-23.2026.8.04.0001',
      movement: { description: 'Sentença publicada', occurredAt: '2026-09-20T12:00:00.000Z' },
    });
    expect(message).toContain('0000001-23.2026.8.04.0001');
    expect(message).toContain('Sentença publicada');
    expect(message).toContain('20/09/2026');
  });

  it('usa "data não informada" quando occurredAt é null', () => {
    const template = new GeneralMovementTemplate();
    const message = template.render({
      cnjNumber: '0000001-23.2026.8.04.0001',
      movement: { description: 'Sem data', occurredAt: null },
    });
    expect(message).toContain('data não informada');
  });
});

describe('PlaceholderMovementTemplate', () => {
  it('substitui os três placeholders suportados', () => {
    const template = new PlaceholderMovementTemplate(
      'Processo {{numero_processo}}: {{movimentacao}} (em {{data}}).',
    );
    const message = template.render({
      cnjNumber: '123',
      movement: { description: 'Juntada de petição', occurredAt: '2026-01-05T12:00:00.000Z' },
    });
    expect(message).toBe('Processo 123: Juntada de petição (em 05/01/2026).');
  });

  it('substitui todas as ocorrências repetidas do mesmo placeholder', () => {
    const template = new PlaceholderMovementTemplate('{{numero_processo}} / {{numero_processo}}');
    const message = template.render({
      cnjNumber: 'ABC',
      movement: { description: 'x', occurredAt: null },
    });
    expect(message).toBe('ABC / ABC');
  });
});

describe('mensagem agrupada (várias movimentações)', () => {
  const movements = [
    {
      description: 'EXPEDIÇÃO DE INTIMAÇÃO\nPrazo de 15 dias',
      occurredAt: '2025-10-31T17:57:30.000Z',
    },
    { description: 'ALVARÁ ENVIADO', occurredAt: '2026-09-08T14:41:19.000Z' },
  ];

  it('modelo padrão: cabeçalho com a quantidade e lista com data, tipo e detalhe', () => {
    const text = new GeneralMovementTemplate().renderDigest({ cnjNumber: '123', movements });
    expect(text).toBe(
      'Olá! O processo 123 teve 2 movimentações:\n\n' +
        '• 31/10/2025 — EXPEDIÇÃO DE INTIMAÇÃO\nPrazo de 15 dias\n\n' +
        '• 08/09/2026 — ALVARÁ ENVIADO',
    );
  });

  it('template do escritório: {{movimentacao}} vira a lista e {{data}} a mais recente', () => {
    const template = new PlaceholderMovementTemplate(
      '{{numero_processo}} ({{data}}):\n{{movimentacao}}',
    );
    const text = template.renderDigest({ cnjNumber: '123', movements });
    expect(text.startsWith('123 (08/09/2026):\n• 31/10/2025 — EXPEDIÇÃO DE INTIMAÇÃO')).toBe(true);
  });

  it('uma movimentação só: igual à mensagem simples', () => {
    const t = new GeneralMovementTemplate();
    expect(t.renderDigest({ cnjNumber: '1', movements: [movements[1]] })).toBe(
      t.render({ cnjNumber: '1', movement: movements[1] }),
    );
  });

  it('divide por quantidade (10) e por tamanho do texto', () => {
    const short = Array.from({ length: 23 }, () => ({ description: 'X', occurredAt: null }));
    expect(chunkForDigest(short).map((c) => c.length)).toEqual([10, 10, 3]);
    const long = Array.from({ length: 3 }, () => ({
      description: 'Y'.repeat(2000),
      occurredAt: null,
    }));
    expect(chunkForDigest(long).map((c) => c.length)).toEqual([1, 1, 1]);
  });
});
