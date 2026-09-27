import { DEFAULT_MESSAGE_TEMPLATE } from '@juriflow/shared-types';

export interface MessageMovement {
  readonly description: string;
  readonly occurredAt: string | null;
}

export interface MovementMessageInput {
  readonly cnjNumber: string;
  readonly movement: MessageMovement;
}

/** Várias movimentações do mesmo processo numa mensagem só (regra N4). */
export interface MovementDigestInput {
  readonly cnjNumber: string;
  /** Em ordem cronológica (mais antiga primeiro). */
  readonly movements: readonly MessageMovement[];
}

/**
 * Porta de template. `GeneralMovementTemplate` é o fallback embutido (RN seção
 * 11) usado quando o espaço/processo não tem template próprio configurado;
 * `PlaceholderMovementTemplate` renderiza o texto que o ADMIN cadastrou em
 * `message_templates`. O pipeline (TrackProcessUseCase) não sabe qual delas
 * está em uso — só chama `render()`/`renderDigest()`.
 */
export interface MessageTemplate {
  render(input: MovementMessageInput): string;
  /**
   * Junta várias movimentações numa mensagem só: o WhatsApp bloqueia número
   * que dispara muitas mensagens seguidas para o mesmo contato (docs do WAHA,
   * "How to avoid blocking"). Com uma movimentação, é igual a `render()`.
   */
  renderDigest(input: MovementDigestInput): string;
}

function formatDate(occurredAt: string | null): string {
  return occurredAt
    ? new Date(occurredAt).toLocaleDateString('pt-BR', { timeZone: 'America/Manaus' })
    : 'data não informada';
}

/** "• 31/10/2025 — EXPEDIÇÃO DE INTIMAÇÃO\n  detalhe…" para cada movimentação. */
export function formatMovementList(movements: readonly MessageMovement[]): string {
  return movements
    .map((m) => {
      const [title, ...detail] = m.description.split('\n');
      const head = `• ${formatDate(m.occurredAt)} — ${title}`;
      return detail.length > 0 ? `${head}\n${detail.join('\n')}` : head;
    })
    .join('\n\n');
}

export class GeneralMovementTemplate implements MessageTemplate {
  render({ cnjNumber, movement }: MovementMessageInput): string {
    return fillPlaceholders(DEFAULT_MESSAGE_TEMPLATE.body, {
      numero_processo: cnjNumber,
      data: formatDate(movement.occurredAt),
      movimentacao: movement.description,
    });
  }

  renderDigest({ cnjNumber, movements }: MovementDigestInput): string {
    if (movements.length === 1) return this.render({ cnjNumber, movement: movements[0] });
    return fillPlaceholders(DEFAULT_MESSAGE_TEMPLATE.digestBody, {
      numero_processo: cnjNumber,
      quantidade: String(movements.length),
      movimentacao: formatMovementList(movements),
    });
  }
}

function fillPlaceholders(body: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{{${key}}}`, value),
    body,
  );
}

/**
 * Template configurável pelo ADMIN (tabela `message_templates`). Placeholders
 * suportados: `{{numero_processo}}`, `{{movimentacao}}`, `{{data}}`. Numa
 * mensagem com várias movimentações, `{{movimentacao}}` vira a lista e
 * `{{data}}` a data da mais recente.
 */
export class PlaceholderMovementTemplate implements MessageTemplate {
  constructor(private readonly body: string) {}

  render({ cnjNumber, movement }: MovementMessageInput): string {
    return this.fill(cnjNumber, movement.description, formatDate(movement.occurredAt));
  }

  renderDigest({ cnjNumber, movements }: MovementDigestInput): string {
    if (movements.length === 1) return this.render({ cnjNumber, movement: movements[0] });
    const latest = movements[movements.length - 1];
    return this.fill(cnjNumber, formatMovementList(movements), formatDate(latest.occurredAt));
  }

  private fill(cnjNumber: string, movimentacao: string, data: string): string {
    return this.body
      .replaceAll('{{numero_processo}}', cnjNumber)
      .replaceAll('{{movimentacao}}', movimentacao)
      .replaceAll('{{data}}', data);
  }
}

/** Limites de uma mensagem agrupada — acima disso, divide em mais mensagens. */
export const DIGEST_MAX_MOVEMENTS = 10;
export const DIGEST_MAX_CHARS = 3500;

/**
 * Divide as movimentações em grupos que cabem numa mensagem (por quantidade
 * e por tamanho do texto), mantendo a ordem.
 */
export function chunkForDigest<T extends MessageMovement>(movements: readonly T[]): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let chars = 0;
  for (const m of movements) {
    const size = m.description.length + 20;
    if (
      current.length > 0 &&
      (current.length >= DIGEST_MAX_MOVEMENTS || chars + size > DIGEST_MAX_CHARS)
    ) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(m);
    chars += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
