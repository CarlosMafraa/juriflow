import { describe, expect, it } from 'vitest';
import { SourceRegistry } from './registry.js';
import { SourceAlreadyRegisteredError, SourceNotRegisteredError } from './errors.js';
import type { ProcessDataSource, SourceTarget } from './source.js';

function fakeSource(kind: string, handles = true): ProcessDataSource {
  return {
    kind,
    canHandle: () => handles,
    fetch: async () => ({ sourceKind: kind, collectedAt: new Date().toISOString(), movements: [] }),
  };
}

const target: SourceTarget = { cnjNumber: null, courtId: 'court-1' };

describe('SourceRegistry', () => {
  it('registra e cria uma fonte', () => {
    const reg = new SourceRegistry();
    reg.register('datajud', () => fakeSource('datajud'));
    expect(reg.has('datajud')).toBe(true);
    expect(reg.kinds()).toEqual(['datajud']);
    expect(reg.create('datajud').kind).toBe('datajud');
  });

  it('recusa registro duplicado', () => {
    const reg = new SourceRegistry();
    reg.register('scraper', () => fakeSource('scraper'));
    expect(() => reg.register('scraper', () => fakeSource('scraper'))).toThrow(
      SourceAlreadyRegisteredError,
    );
  });

  it('lança quando a fonte não existe', () => {
    const reg = new SourceRegistry();
    expect(() => reg.create('projudi_tjam')).toThrow(SourceNotRegisteredError);
  });

  it('resolveFor exige que a fonte trate o alvo', () => {
    const reg = new SourceRegistry();
    reg.register('tribunal_api', () => fakeSource('tribunal_api', false));
    expect(() => reg.resolveFor('tribunal_api', target)).toThrow(SourceNotRegisteredError);
  });

  it('permite adicionar uma nova fonte arbitrária sem alterar o core', () => {
    const reg = new SourceRegistry();
    reg.register('tjrj_futuro', () => fakeSource('tjrj_futuro'));
    expect(reg.resolveFor('tjrj_futuro', target).kind).toBe('tjrj_futuro');
  });
});
