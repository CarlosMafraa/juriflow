import {
  collectionStatusLabel,
  friendlyCollectionError,
  hasDelayWarning,
  sourceLabel,
} from './tracking-labels';

describe('tracking-labels', () => {
  it('sourceLabel mapeia fontes conhecidas e mantém o resto', () => {
    expect(sourceLabel('datajud')).toBe('DataJud (CNJ)');
    expect(sourceLabel('outra_fonte')).toBe('outra_fonte');
  });

  it('hasDelayWarning só para DataJud', () => {
    expect(hasDelayWarning('datajud')).toBe(true);
    expect(hasDelayWarning('projudi_tjam')).toBe(false);
  });

  it('friendlyCollectionError traduz códigos e cai para genérico', () => {
    expect(friendlyCollectionError('auth_failed')).toContain('administrador');
    expect(friendlyCollectionError('coisa_nova')).toBe(friendlyCollectionError('unknown'));
    expect(friendlyCollectionError(null)).toBe('');
  });

  it('collectionStatusLabel', () => {
    expect(collectionStatusLabel('partial')).toContain('Parcial');
    expect(collectionStatusLabel('success')).toBe('Concluída');
    expect(collectionStatusLabel(undefined)).toBe('—');
  });
});
