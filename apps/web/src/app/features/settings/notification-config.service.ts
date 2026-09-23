import { Injectable, inject } from '@angular/core';
import type { ProcessNotificationConfig, SpaceNotificationConfig } from '@juriflow/shared-types';
import { SUPABASE_CLIENT } from '../../core/supabase/supabase-client';
import { AuthService } from '../../core/auth/auth.service';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';

interface SpaceConfigRow {
  space_id: string;
  notify_responsible: boolean;
  notify_clients: boolean;
  responsible_template_id: string | null;
  client_template_id: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string | null;
}

interface ProcessConfigRow {
  process_id: string;
  space_id: string;
  notify_responsible: boolean | null;
  notify_clients: boolean | null;
  responsible_template_id: string | null;
  client_template_id: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface SpaceNotificationConfigInput {
  notifyResponsible: boolean;
  notifyClients: boolean;
  responsibleTemplateId: string | null;
  clientTemplateId: string | null;
}

/** Igual ao do espaço, mas cada campo pode ser `null` (= herda do espaço). */
export type ProcessNotificationConfigInput = {
  [K in keyof SpaceNotificationConfigInput]: SpaceNotificationConfigInput[K] | null;
};

function toSpaceConfig(r: SpaceConfigRow): SpaceNotificationConfig {
  return {
    spaceId: r.space_id,
    notifyResponsible: r.notify_responsible,
    notifyClients: r.notify_clients,
    responsibleTemplateId: r.responsible_template_id,
    clientTemplateId: r.client_template_id,
    updatedBy: r.updated_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toProcessConfig(r: ProcessConfigRow): ProcessNotificationConfig {
  return {
    processId: r.process_id,
    spaceId: r.space_id,
    notifyResponsible: r.notify_responsible,
    notifyClients: r.notify_clients,
    responsibleTemplateId: r.responsible_template_id,
    clientTemplateId: r.client_template_id,
    updatedBy: r.updated_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

@Injectable({ providedIn: 'root' })
export class NotificationConfigService {
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly auth = inject(AuthService);
  private readonly activeSpace = inject(ActiveSpaceService);

  private spaceId(): string {
    const id = this.activeSpace.activeSpaceId();
    if (!id) throw new Error('Nenhum espaço ativo.');
    return id;
  }

  async getForSpace(): Promise<SpaceNotificationConfig | null> {
    const { data, error } = await this.supabase
      .from('space_notification_configs')
      .select('*')
      .eq('space_id', this.spaceId())
      .maybeSingle();
    if (error) throw error;
    return data ? toSpaceConfig(data as SpaceConfigRow) : null;
  }

  async upsertForSpace(input: SpaceNotificationConfigInput): Promise<void> {
    const { error } = await this.supabase.from('space_notification_configs').upsert({
      space_id: this.spaceId(),
      notify_responsible: input.notifyResponsible,
      notify_clients: input.notifyClients,
      responsible_template_id: input.responsibleTemplateId,
      client_template_id: input.clientTemplateId,
      updated_by: this.auth.userId(),
    });
    if (error) throw error;
  }

  async getForProcess(processId: string): Promise<ProcessNotificationConfig | null> {
    const { data, error } = await this.supabase
      .from('process_notification_configs')
      .select('*')
      .eq('process_id', processId)
      .maybeSingle();
    if (error) throw error;
    return data ? toProcessConfig(data as ProcessConfigRow) : null;
  }

  async upsertForProcess(processId: string, input: ProcessNotificationConfigInput): Promise<void> {
    const { error } = await this.supabase.from('process_notification_configs').upsert({
      process_id: processId,
      space_id: this.spaceId(),
      notify_responsible: input.notifyResponsible,
      notify_clients: input.notifyClients,
      responsible_template_id: input.responsibleTemplateId,
      client_template_id: input.clientTemplateId,
      updated_by: this.auth.userId(),
    });
    if (error) throw error;
  }

  async clearProcessOverride(processId: string): Promise<void> {
    const { error } = await this.supabase
      .from('process_notification_configs')
      .delete()
      .eq('process_id', processId);
    if (error) throw error;
  }
}
