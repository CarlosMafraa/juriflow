export interface MovementMessageInput {
  readonly cnjNumber: string;
  readonly movement: {
    readonly description: string;
    readonly occurredAt: string | null;
  };
}

/**
 * Porta de template. `GeneralMovementTemplate` é o fallback embutido (RN seção
 * 11) usado quando o espaço/processo não tem template próprio configurado;
 * `PlaceholderMovementTemplate` renderiza o texto que o ADMIN cadastrou em
 * `message_templates`. O pipeline (TrackProcessUseCase) não sabe qual delas
 * está em uso — só chama `render()`.
 */
export interface MessageTemplate {
  render(input: MovementMessageInput): string;
}

export class GeneralMovementTemplate implements MessageTemplate {
  render({ cnjNumber, movement }: MovementMessageInput): string {
    const date = movement.occurredAt
      ? new Date(movement.occurredAt).toLocaleDateString('pt-BR')
      : 'data não informada';
    return (
      `Olá! Houve uma nova movimentação no processo ${cnjNumber}.\n\n` +
      `Data: ${date}\n` +
      `Movimentação: ${movement.description}`
    );
  }
}

/**
 * Template configurável pelo ADMIN (tabela `message_templates`). Placeholders
 * suportados: `{{numero_processo}}`, `{{movimentacao}}`, `{{data}}`.
 */
export class PlaceholderMovementTemplate implements MessageTemplate {
  constructor(private readonly body: string) {}

  render({ cnjNumber, movement }: MovementMessageInput): string {
    const date = movement.occurredAt
      ? new Date(movement.occurredAt).toLocaleDateString('pt-BR')
      : 'data não informada';
    return this.body
      .replaceAll('{{numero_processo}}', cnjNumber)
      .replaceAll('{{movimentacao}}', movement.description)
      .replaceAll('{{data}}', date);
  }
}
