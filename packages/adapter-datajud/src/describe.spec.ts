import { describe, expect, it } from 'vitest';
import { buildDescription } from './describe.js';

describe('buildDescription', () => {
  it('colapsa espaços do nome base', () => {
    expect(buildDescription('  Juntada   de   Petição ')).toBe('Juntada de Petição');
  });

  it('devolve só o nome quando não há complementos', () => {
    expect(buildDescription('Distribuição', [])).toBe('Distribuição');
    expect(buildDescription('Distribuição', null)).toBe('Distribuição');
    expect(buildDescription('Distribuição')).toBe('Distribuição');
  });

  it('anexa complementos em ordem determinística por código, independente da ordem de entrada', () => {
    const a = buildDescription('Decisão', [
      { codigo: 7, nome: 'tipo', descricao: 'Concessão' },
      { codigo: 3, nome: 'natureza', descricao: 'Liminar' },
    ]);
    const b = buildDescription('Decisão', [
      { codigo: 3, nome: 'natureza', descricao: 'Liminar' },
      { codigo: 7, nome: 'tipo', descricao: 'Concessão' },
    ]);
    expect(a).toBe(b);
    expect(a).toBe('Decisão — natureza: Liminar; tipo: Concessão');
  });

  it('não duplica quando nome e valor do complemento coincidem', () => {
    expect(
      buildDescription('Ato', [{ codigo: 1, nome: 'Publicado', descricao: 'Publicado' }]),
    ).toBe('Ato — Publicado');
  });

  it('é estável para o mesmo conteúdo (base do hash de conteúdo)', () => {
    const comp = [{ codigo: 12, nome: 'x', descricao: 'y' }];
    expect(buildDescription('N', comp)).toBe(buildDescription('N', [...comp]));
  });
});
