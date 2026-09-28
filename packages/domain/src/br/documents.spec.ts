import { describe, expect, it } from 'vitest';
import { formatCnjNumber, isFormattedCnj, onlyDigits } from './documents.js';

describe('onlyDigits', () => {
  it('remove tudo que não é dígito', () => {
    expect(onlyDigits('123.456.789-09')).toBe('12345678909');
  });
});

describe('formatCnjNumber', () => {
  it('mascara 20 dígitos', () => {
    expect(formatCnjNumber('00012345620248190001')).toBe('0001234-56.2024.8.19.0001');
    expect(formatCnjNumber('0001234-56.2024.8.19.0001')).toBe('0001234-56.2024.8.19.0001');
  });
  it('retorna null se não houver 20 dígitos', () => {
    expect(formatCnjNumber('123')).toBeNull();
  });
});

describe('isFormattedCnj', () => {
  it('aceita o padrão CNJ', () => {
    expect(isFormattedCnj('0001234-56.2024.8.19.0001')).toBe(true);
  });
  it('rejeita fora do padrão', () => {
    expect(isFormattedCnj('123456')).toBe(false);
    expect(isFormattedCnj('00012345620248190001')).toBe(false);
  });
});
