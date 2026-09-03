import { describe, expect, it } from 'vitest';
import {
  formatCnjNumber,
  isFormattedCnj,
  isValidClientDocument,
  isValidCnpj,
  isValidCpf,
  onlyDigits,
} from './documents.js';

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

describe('CPF', () => {
  it('valida CPFs corretos', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('11144477735')).toBe(true);
  });
  it('rejeita CPFs inválidos', () => {
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('529.982.247-24')).toBe(false);
    expect(isValidCpf('123')).toBe(false);
  });
});

describe('CNPJ', () => {
  it('valida CNPJs corretos', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
  });
  it('rejeita CNPJs inválidos', () => {
    expect(isValidCnpj('11.222.333/0001-80')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
  });
});

describe('isValidClientDocument', () => {
  it('documento vazio é válido (opcional)', () => {
    expect(isValidClientDocument('PF', null)).toBe(true);
    expect(isValidClientDocument('PJ', '')).toBe(true);
  });
  it('PF usa CPF, PJ usa CNPJ', () => {
    expect(isValidClientDocument('PF', '529.982.247-25')).toBe(true);
    expect(isValidClientDocument('PJ', '11.222.333/0001-81')).toBe(true);
    expect(isValidClientDocument('PF', '11.222.333/0001-81')).toBe(false);
  });
});
