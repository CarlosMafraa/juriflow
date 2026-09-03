import { Injectable, computed, inject } from '@angular/core';
import { can, type AuthSubject, type Permission } from '@juriflow/domain';
import { AuthService } from '../auth/auth.service';
import { ActiveSpaceService } from './active-space.service';

const ANONYMOUS: AuthSubject = { userId: '', isSuperAdmin: false, memberships: [] };

/**
 * Única porta de autorização do frontend. Delega a decisão ao `@juriflow/domain`
 * (mesma lógica do backend). NÃO é barreira de segurança — apenas esconde/bloqueia
 * navegação. O banco (RLS) e a API decidem de verdade. Ver ADR-0003.
 */
@Injectable({ providedIn: 'root' })
export class PermissionService {
  private readonly auth = inject(AuthService);
  private readonly activeSpace = inject(ActiveSpaceService);

  private readonly subject = computed<AuthSubject>(() => this.auth.authSubject() ?? ANONYMOUS);

  /** Reativo: use em templates/computed. */
  can(permission: Permission, spaceId?: string): boolean {
    const scope = spaceId ?? this.activeSpace.activeSpaceId() ?? undefined;
    return can(this.subject(), permission, scope ? { spaceId: scope } : {});
  }

  /** Snapshot para lógica imperativa (guards). */
  canNow(permission: Permission, spaceId?: string): boolean {
    return this.can(permission, spaceId);
  }
}
