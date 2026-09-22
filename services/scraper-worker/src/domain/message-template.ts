export interface MovementMessageInput {
  readonly cnjNumber: string;
  readonly movement: {
    readonly description: string;
    readonly occurredAt: string | null;
  };
}

/**
 * Porta de template — hoje só existe `GeneralMovementTemplate` (RN seção 11:
 * "1 template geral" no MVP). Templates por status/destinatário (Fase 10)
 * entram como novas implementações desta interface, sem tocar no pipeline.
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
