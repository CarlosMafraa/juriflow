import { describe, expect, it } from 'vitest';
import { GeneralMovementTemplate, PlaceholderMovementTemplate } from './message-template.js';

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
