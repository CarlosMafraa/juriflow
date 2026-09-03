import { Injectable, inject } from '@angular/core';
import { onlyDigits } from '@juriflow/domain';
import type { Client, ClientType } from '@juriflow/shared-types';
import { SUPABASE_CLIENT } from '../../core/supabase/supabase-client';
import { AuthService } from '../../core/auth/auth.service';
import { ActiveSpaceService } from '../../core/authorization/active-space.service';

interface ClientRow {
  id: string;
  space_id: string;
  type: ClientType;
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  notification_opt_in: boolean;
  opt_in_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
}

export interface ClientFilters {
  search?: string;
  document?: string;
  type?: ClientType | '';
  phone?: string;
  email?: string;
  page?: number;
  pageSize?: number;
}

export interface ClientInput {
  type: ClientType;
  name: string;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  birthDate?: string | null;
  notificationOptIn?: boolean;
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

function toClient(r: ClientRow): Client {
  return {
    id: r.id,
    spaceId: r.space_id,
    type: r.type,
    name: r.name,
    document: r.document,
    email: r.email,
    phone: r.phone,
    birthDate: r.birth_date,
    notificationOptIn: r.notification_opt_in,
    optInAt: r.opt_in_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

const DEFAULT_PAGE_SIZE = 20;

@Injectable({ providedIn: 'root' })
export class ClientService {
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly auth = inject(AuthService);
  private readonly activeSpace = inject(ActiveSpaceService);

  private spaceId(): string {
    const id = this.activeSpace.activeSpaceId();
    if (!id) throw new Error('Nenhum espaço ativo.');
    return id;
  }

  async list(filters: ClientFilters = {}): Promise<Page<Client>> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
    const from = (page - 1) * pageSize;

    let q = this.supabase
      .from('clients')
      .select('*', { count: 'exact' })
      .eq('space_id', this.spaceId())
      .order('name')
      .range(from, from + pageSize - 1);

    if (filters.search?.trim()) q = q.ilike('name', `%${filters.search.trim()}%`);
    if (filters.type) q = q.eq('type', filters.type);
    if (filters.document?.trim()) q = q.ilike('document', `%${onlyDigits(filters.document)}%`);
    if (filters.phone?.trim()) q = q.ilike('phone', `%${filters.phone.trim()}%`);
    if (filters.email?.trim()) q = q.ilike('email', `%${filters.email.trim()}%`);

    const { data, error, count } = await q;
    if (error) throw error;
    return {
      rows: ((data ?? []) as ClientRow[]).map(toClient),
      total: count ?? 0,
      page,
      pageSize,
    };
  }

  async search(term: string, limit = 10): Promise<Client[]> {
    const { data, error } = await this.supabase
      .from('clients')
      .select('*')
      .eq('space_id', this.spaceId())
      .ilike('name', `%${term.trim()}%`)
      .order('name')
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as ClientRow[]).map(toClient);
  }

  async getById(id: string): Promise<Client | null> {
    const { data, error } = await this.supabase.from('clients').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? toClient(data as ClientRow) : null;
  }

  async create(input: ClientInput): Promise<Client> {
    const optIn = input.notificationOptIn ?? false;
    const { data, error } = await this.supabase
      .from('clients')
      .insert({
        space_id: this.spaceId(),
        created_by: this.auth.userId(),
        type: input.type,
        name: input.name.trim(),
        document: input.document?.trim() || null,
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        birth_date: input.type === 'PF' ? input.birthDate || null : null,
        notification_opt_in: optIn,
        opt_in_at: optIn ? new Date().toISOString() : null,
      })
      .select('*')
      .single();
    if (error) throw error;
    return toClient(data as ClientRow);
  }

  async update(id: string, input: ClientInput): Promise<void> {
    const optIn = input.notificationOptIn ?? false;
    const { error } = await this.supabase
      .from('clients')
      .update({
        type: input.type,
        name: input.name.trim(),
        document: input.document?.trim() || null,
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        birth_date: input.type === 'PF' ? input.birthDate || null : null,
        notification_opt_in: optIn,
        opt_in_at: optIn ? new Date().toISOString() : null,
      })
      .eq('id', id);
    if (error) throw error;
  }

  async softDelete(id: string): Promise<void> {
    const { error } = await this.supabase.rpc('soft_delete_client', { p_client_id: id });
    if (error) throw error;
  }
}
