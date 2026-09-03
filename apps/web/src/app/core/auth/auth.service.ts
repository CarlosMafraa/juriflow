import { Injectable, computed, inject, signal } from '@angular/core';
import type { Session } from '@supabase/supabase-js';
import type { AuthSubject } from '@juriflow/domain';
import { SUPABASE_CLIENT } from '../supabase/supabase-client';
import { Logger } from '../observability/logger';
import type { AuthContext, AuthStatus, Membership } from './auth.models';

interface MembershipRow {
  space_id: string;
  role: Membership['role'];
  status: Membership['status'];
  spaces: { name: string } | { name: string }[] | null;
}

/**
 * Autenticação (quem é o usuário) — SEPARADA da autorização (o que ele pode).
 * A autorização vive em `PermissionService` + `@juriflow/domain`.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly logger = inject(Logger);

  private readonly _session = signal<Session | null>(null);
  private readonly _context = signal<AuthContext | null>(null);
  private readonly _status = signal<AuthStatus>('unknown');

  readonly session = this._session.asReadonly();
  readonly context = this._context.asReadonly();
  readonly status = this._status.asReadonly();

  readonly userId = computed(() => this._session()?.user.id ?? null);
  readonly isAuthenticated = computed(() => this._status() === 'authenticated');
  readonly memberships = computed<Membership[]>(() => this._context()?.memberships ?? []);

  /** Fatos mínimos para decisão de autorização (consumido por `@juriflow/domain`). */
  readonly authSubject = computed<AuthSubject | null>(() => {
    const ctx = this._context();
    if (!ctx) return null;
    return {
      userId: ctx.userId,
      isSuperAdmin: ctx.profile?.isSuperAdmin ?? false,
      memberships: ctx.memberships.map((m) => ({
        spaceId: m.spaceId,
        role: m.role,
        status: m.status,
      })),
    };
  });

  /** Chamado uma vez no bootstrap: hidrata sessão e inscreve mudanças. */
  async initialize(): Promise<void> {
    const { data } = await this.supabase.auth.getSession();
    await this.applySession(data.session);

    this.supabase.auth.onAuthStateChange((_event, session) => {
      void this.applySession(session);
    });
  }

  async signInWithPassword(email: string, password: string): Promise<void> {
    const { error } = await this.supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async signOut(): Promise<void> {
    await this.supabase.auth.signOut();
    this._context.set(null);
    this._session.set(null);
    this._status.set('anonymous');
  }

  async sendPasswordReset(email: string, redirectTo: string): Promise<void> {
    const { error } = await this.supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  }

  async updatePassword(newPassword: string): Promise<void> {
    const { error } = await this.supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  private async applySession(session: Session | null): Promise<void> {
    this._session.set(session);
    if (!session) {
      this._context.set(null);
      this._status.set('anonymous');
      return;
    }
    try {
      this._context.set(await this.loadContext(session));
      this._status.set('authenticated');
    } catch (err) {
      this.logger.error('Falha ao carregar contexto do usuário', { err: String(err) });
      // Sessão existe, mas o contexto falhou: trate como anônimo para não expor UI.
      this._context.set(null);
      this._status.set('anonymous');
    }
  }

  private async loadContext(session: Session): Promise<AuthContext> {
    const userId = session.user.id;

    const [{ data: profileRow, error: profileErr }, { data: memberRows, error: memberErr }] =
      await Promise.all([
        this.supabase
          .from('profiles')
          .select('id, full_name, email, phone, is_super_admin, avatar_url, created_at, updated_at')
          .eq('id', userId)
          .maybeSingle(),
        this.supabase
          .from('space_members')
          .select('space_id, role, status, spaces(name)')
          .eq('profile_id', userId),
      ]);

    if (profileErr) throw profileErr;
    if (memberErr) throw memberErr;

    const memberships: Membership[] = ((memberRows ?? []) as MembershipRow[]).map((row) => ({
      spaceId: row.space_id,
      role: row.role,
      status: row.status,
      spaceName: Array.isArray(row.spaces)
        ? (row.spaces[0]?.name ?? null)
        : (row.spaces?.name ?? null),
    }));

    return {
      userId,
      email: session.user.email ?? '',
      profile: profileRow
        ? {
            id: profileRow.id,
            fullName: profileRow.full_name,
            email: profileRow.email,
            phone: profileRow.phone,
            isSuperAdmin: profileRow.is_super_admin,
            avatarUrl: profileRow.avatar_url,
            createdAt: profileRow.created_at,
            updatedAt: profileRow.updated_at,
          }
        : null,
      memberships,
    };
  }
}
