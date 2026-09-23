import { Injectable, inject } from '@angular/core';
import type { MessageTemplate, NotificationAudience } from '@juriflow/shared-types';
import { SUPABASE_CLIENT } from '../../core/supabase/supabase-client';
import { AuthService } from '../../core/auth/auth.service';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';

interface TemplateRow {
  id: string;
  space_id: string;
  name: string;
  audience: NotificationAudience;
  body: string;
  created_by: string;
  created_at: string;
  updated_at: string | null;
}

export interface TemplateInput {
  name: string;
  audience: NotificationAudience;
  body: string;
}

function toTemplate(r: TemplateRow): MessageTemplate {
  return {
    id: r.id,
    spaceId: r.space_id,
    name: r.name,
    audience: r.audience,
    body: r.body,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

@Injectable({ providedIn: 'root' })
export class TemplateService {
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly auth = inject(AuthService);
  private readonly activeSpace = inject(ActiveSpaceService);

  private spaceId(): string {
    const id = this.activeSpace.activeSpaceId();
    if (!id) throw new Error('Nenhum espaço ativo.');
    return id;
  }

  async list(): Promise<MessageTemplate[]> {
    const { data, error } = await this.supabase
      .from('message_templates')
      .select('*')
      .eq('space_id', this.spaceId())
      .order('audience')
      .order('name');
    if (error) throw error;
    return ((data ?? []) as TemplateRow[]).map(toTemplate);
  }

  async create(input: TemplateInput): Promise<MessageTemplate> {
    const { data, error } = await this.supabase
      .from('message_templates')
      .insert({
        space_id: this.spaceId(),
        created_by: this.auth.userId(),
        name: input.name.trim(),
        audience: input.audience,
        body: input.body.trim(),
      })
      .select('*')
      .single();
    if (error) throw error;
    return toTemplate(data as TemplateRow);
  }

  async update(id: string, input: TemplateInput): Promise<void> {
    const { error } = await this.supabase
      .from('message_templates')
      .update({ name: input.name.trim(), audience: input.audience, body: input.body.trim() })
      .eq('id', id);
    if (error) throw error;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.from('message_templates').delete().eq('id', id);
    if (error) throw error;
  }
}
