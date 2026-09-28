import { DEFAULT_BIRTHDAY_TEMPLATES, type BirthdayAudience } from '@juriflow/shared-types';
import { localDay, renderBirthdayMessage } from '../domain/birthday-template.js';
import type { Logger } from '../infra/logger.js';
import type { BirthdayPerson, BirthdayRepository } from '../ports/birthday.port.js';
import type { MessagingChannel } from '../ports/messaging-channel.port.js';
import type { Notifier } from '../ports/notifier.port.js';
import type { SerialQueue } from './serial-queue.js';

/**
 * Parabéns de aniversário (N14): equipe do escritório e clientes com aceite de
 * avisos, pelo WhatsApp do próprio espaço. Roda de hora em hora a partir das
 * 9h: quem não recebeu às 9h (WhatsApp desconectado, falha) recebe na próxima
 * rodada do mesmo dia; quem já recebeu nunca recebe de novo.
 */
export class BirthdayJob {
  private running = false;

  constructor(
    private readonly repository: BirthdayRepository,
    private readonly channel: MessagingChannel,
    private readonly notifier: Notifier,
    /** A mesma fila da coleta/avisos: o ritmo anti-bloqueio vale para tudo. */
    private readonly queue: SerialQueue,
    private readonly logger: Logger,
    private readonly timeZone: string,
  ) {}

  async run(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const day = localDay(now, this.timeZone);
      const due = (await this.repository.listOn(day)).filter((p) => !p.done);
      if (due.length === 0) return;

      const bySpace = new Map<string, BirthdayPerson[]>();
      for (const person of due)
        bySpace.set(person.spaceId, [...(bySpace.get(person.spaceId) ?? []), person]);

      for (const [spaceId, people] of bySpace) {
        try {
          await this.greetSpace(spaceId, people, day);
        } catch (error) {
          this.logger.error('Falha nos parabéns do espaço.', { spaceId, error: String(error) });
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async greetSpace(spaceId: string, people: BirthdayPerson[], day: string): Promise<void> {
    if (!(await this.channel.isConnected(spaceId))) {
      this.logger.warn('WhatsApp desconectado — parabéns ficam para a próxima rodada.', {
        spaceId,
        pending: people.length,
      });
      return;
    }
    const chosen = await this.repository.templatesFor(spaceId);
    const bodyFor = (type: BirthdayAudience): string =>
      chosen[type] ?? DEFAULT_BIRTHDAY_TEMPLATES[type].body;

    for (const person of people) {
      const record = {
        spaceId,
        type: person.type,
        recipientId: person.recipientId,
        day,
        phone: person.phone,
      };
      const message = renderBirthdayMessage(bodyFor(person.type), person);
      try {
        await this.queue.run(() => this.notifier.sendText(spaceId, person.phone, message));
        await this.repository.recordSent(record);
      } catch (error) {
        await this.repository.recordFailed(
          record,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    this.logger.info('Parabéns de aniversário processados.', { spaceId, people: people.length });
  }
}
