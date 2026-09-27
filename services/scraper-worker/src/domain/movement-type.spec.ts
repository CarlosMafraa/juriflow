import { describe, expect, it } from 'vitest';
import {
  mergeMovementTypeAudiences,
  movementTypeKey,
  normalizeMovementType,
} from './movement-type.js';

describe('normalizeMovementType', () => {
  it('padroniza caixa e espaços', () => {
    expect(normalizeMovementType('  expedição   de intimação ')).toBe('EXPEDIÇÃO DE INTIMAÇÃO');
  });

  it('tira o nome da parte dos tipos que o trazem (LGPD)', () => {
    expect(normalizeMovementType('DECORRIDO PRAZO DE BANCO FICTÍCIO S.A.')).toBe('DECORRIDO PRAZO');
    expect(normalizeMovementType('RENÚNCIA DE PRAZO DE FULANO DE TAL')).toBe('RENÚNCIA DE PRAZO');
  });

  it('não confunde tipos parecidos', () => {
    expect(normalizeMovementType('EXPEDIÇÃO DE CITAÇÃO')).toBe('EXPEDIÇÃO DE CITAÇÃO');
    expect(normalizeMovementType('JUNTADA DE ANÁLISE DE DECURSO DE PRAZO')).toBe(
      'JUNTADA DE ANÁLISE DE DECURSO DE PRAZO',
    );
  });

  it('sem título → null', () => {
    expect(normalizeMovementType(undefined)).toBeNull();
    expect(normalizeMovementType('   ')).toBeNull();
  });
});

describe('mergeMovementTypeAudiences', () => {
  const on = { responsible: true, client: true };
  const off = { responsible: false, client: false };

  it('compara ignorando acentos e caixa', () => {
    expect(movementTypeKey('Expedição de Intimação')).toBe(
      movementTypeKey('EXPEDICAO DE INTIMACAO'),
    );
    const audiences = mergeMovementTypeAudiences(new Map([['ALVARÁ ENVIADO', off]]), new Map());
    expect(audiences('alvara enviado')).toEqual(off);
  });

  it('processo vence o escritório; tipo desconhecido ou nulo avisa todos', () => {
    const audiences = mergeMovementTypeAudiences(
      new Map([['ALVARÁ ENVIADO', off]]),
      new Map([['ALVARÁ ENVIADO', on]]),
    );
    expect(audiences('ALVARÁ ENVIADO')).toEqual(on);
    expect(audiences('TIPO NOVO')).toEqual(on);
    expect(audiences(null)).toEqual(on);
  });
});
