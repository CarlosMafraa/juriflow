import type { SupabaseClient } from '@supabase/supabase-js';
import type { BirthdayAudience } from '@juriflow/shared-types';
import type {
  BirthdayGreetingRecord,
  BirthdayPerson,
  BirthdayRepository,
} from '../ports/birthday.port.js';

interface BirthdayRow {
  space_id: string;
  space_name: string;
  recipient_type: BirthdayAudience;
  recipient_id: string;
  full_name: string | null;
  phone: string;
  done: boolean;
}

const RECIPIENT_COLUMN: Record<BirthdayAudience, string> = {
  team: 'recipient_profile_id',
  client: 'recipient_client_id',
};

/**
 * `birthday_greetings` tem índices únicos parciais (por público): como em
 * notification_deliveries, select-então-update/insert em vez de upsert.
 */
export class SupabaseBirthdayRepository implements BirthdayRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listOn(day: string): Promise<readonly BirthdayPerson[]> {
    const { data, error } = await this.client.rpc('worker_birthdays_on', { p_day: day });
    if (error) throw new Error(`Falha ao listar aniversariantes: ${error.message}`);
    return ((data ?? []) as BirthdayRow[]).map((r) => ({
      spaceId: r.space_id,
      spaceName: r.space_name,
      type: r.recipient_type,
      recipientId: r.recipient_id,
      fullName: r.full_name ?? '',
      phone: r.phone,
      done: r.done,
    }));
  }

  async templatesFor(spaceId: string): Promise<Record<BirthdayAudience, string | null>> {
    const { data, error } = await this.client
      .from('space_notification_configs')
      .select(
        'team:message_templates!space_notification_configs_team_birthday_template_id_fkey(body), client:message_templates!space_notification_configs_client_birthday_template_id_fkey(body)',
      )
      .eq('space_id', spaceId)
      .maybeSingle<{ team: { body: string } | null; client: { body: string } | null }>();
    if (error) throw new Error(`Falha ao ler templates de aniversário: ${error.message}`);
    return { team: data?.team?.body ?? null, client: data?.client?.body ?? null };
  }

  async recordSent(record: BirthdayGreetingRecord): Promise<void> {
    await this.write(record, { status: 'sent', error: null, sentAt: new Date().toISOString() });
  }

  async recordFailed(record: BirthdayGreetingRecord, error: string): Promise<void> {
    await this.write(record, { status: 'failed', error, sentAt: null });
  }

  private async write(
    record: BirthdayGreetingRecord,
    outcome: { status: 'sent' | 'failed'; error: string | null; sentAt: string | null },
  ): Promise<void> {
    const column = RECIPIENT_COLUMN[record.type];
    const { data: existing, error: readError } = await this.client
      .from('birthday_greetings')
      .select('id, attempts')
      .eq('space_id', record.spaceId)
      .eq('recipient_type', record.type)
      .eq(column, record.recipientId)
      .eq('greeting_date', record.day)
      .maybeSingle<{ id: string; attempts: number }>();
    if (readError) throw new Error(`Falha ao ler birthday_greetings: ${readError.message}`);

    const payload = {
      status: outcome.status,
      error: outcome.error,
      sent_at: outcome.sentAt,
      phone: record.phone,
      attempts: existing ? existing.attempts + 1 : 1,
    };
    const { error } = existing
      ? await this.client.from('birthday_greetings').update(payload).eq('id', existing.id)
      : await this.client.from('birthday_greetings').insert({
          space_id: record.spaceId,
          recipient_type: record.type,
          [column]: record.recipientId,
          greeting_date: record.day,
          ...payload,
        });
    if (error) throw new Error(`Falha ao registrar parabéns: ${error.message}`);
  }
}
