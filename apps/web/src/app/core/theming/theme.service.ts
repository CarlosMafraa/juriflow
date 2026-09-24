import { Injectable } from '@angular/core';
import { updatePrimaryPalette } from '@primeng/themes';
import { generatePalette } from './palette';

const PRIMARY = '#1f385d';

/**
 * Tema fixo do app inteiro — o azul do login, sem modo escuro e sem
 * customização por espaço (já tentamos os dois, não ficou bom). Botão
 * padrão: fundo navy, letra branca — é o estilo default do PrimeNG pra um
 * `primary.color` custom, não precisa de override nosso. Botão secondary
 * (Cancelar) também fica no default do PrimeNG: fundo claro neutro, texto
 * escuro.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  constructor() {
    updatePrimaryPalette(generatePalette(PRIMARY));
  }
}
