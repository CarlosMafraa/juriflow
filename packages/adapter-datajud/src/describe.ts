/**
 * Descrição textual determinística de uma movimentação do DataJud.
 *
 * Pura: mesma entrada ⇒ mesma saída (o hash de conteúdo depende disso).
 * O objeto original é sempre preservado em `RawMovement.raw` — aqui só
 * derivamos o texto legível.
 */

/** Complemento tabelado como vem no `_source.movimentos[].complementosTabelados[]`. */
export interface DataJudComplemento {
  readonly codigo?: number | string | null;
  readonly valor?: number | string | null;
  readonly nome?: string | null;
  readonly descricao?: string | null;
}

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function complementoText(c: DataJudComplemento): string {
  const label = collapseSpaces(String(c.nome ?? ''));
  const value = collapseSpaces(String(c.descricao ?? c.valor ?? ''));
  if (label && value && label.toLowerCase() !== value.toLowerCase()) return `${label}: ${value}`;
  return label || value;
}

/** Chave de ordenação estável: `codigo` numérico primeiro, depois `nome`. */
function sortKey(c: DataJudComplemento): string {
  const codigo = c.codigo ?? '';
  const asNumber = Number(codigo);
  const codigoPart = Number.isFinite(asNumber)
    ? String(asNumber).padStart(12, '0')
    : `z${String(codigo)}`;
  return `${codigoPart}${collapseSpaces(String(c.nome ?? ''))}`;
}

/**
 * Monta a descrição: nome base do movimento + complementos tabelados numa
 * ordem determinística (por `codigo`, depois `nome`). Não inventa dados.
 */
export function buildDescription(
  nome: string | null | undefined,
  complementos?: readonly DataJudComplemento[] | null,
): string {
  const base = collapseSpaces(String(nome ?? ''));
  if (!complementos || complementos.length === 0) return base;

  const parts = [...complementos]
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'pt-BR'))
    .map(complementoText)
    .filter((s) => s.length > 0);

  if (parts.length === 0) return base;
  return base ? `${base} — ${parts.join('; ')}` : parts.join('; ');
}
