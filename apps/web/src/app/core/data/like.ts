/**
 * Padrão "contém" para `.ilike()` com os curingas do LIKE (`%`, `_`) e a barra
 * escapados: sem isso, buscar "10%" ou "a_b" casa coisas que o usuário não
 * digitou (e `%` sozinho vira "traga tudo").
 */
export function likeContains(term: string): string {
  return `%${term.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
