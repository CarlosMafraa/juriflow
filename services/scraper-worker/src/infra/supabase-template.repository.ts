import type { SupabaseClient } from '@supabase/supabase-js';
import type { TemplateRepository } from '../ports/template-repository.port.js';

export class SupabaseTemplateRepository implements TemplateRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getBodyById(templateId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('message_templates')
      .select('body')
      .eq('id', templateId)
      .maybeSingle<{ body: string }>();
    if (error) throw new Error(`Falha ao buscar template ${templateId}: ${error.message}`);
    return data?.body ?? null;
  }
}
