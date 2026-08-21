import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';

import { environment } from '../../../environments/environment';
import { initials } from '../../shared/utils/format';
import { AppNotification, User } from '../models/domain.models';
import { GlobalRole, MembersService } from './members.service';

/** The shape /auth/me actually returns (API-REFERENCE.md, "GET /auth/me"). */
interface AuthMe {
  oid: string;
  tid: string;
  email: string;
  name: string;
  devBypass: boolean;
  tenantId: string;
  userId: string;
}

/** Blank rather than a fabricated identity - shown only for the moment before /auth/me resolves. */
const PENDING_USER: User = { id: '', name: '', email: '', role: 'analyst', initials: '' };

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly http = inject(HttpClient);
  private readonly membersService = inject(MembersService);

  readonly user = signal<User>(PENDING_USER);
  /** No /notifications route exists on the real API yet (API-REFERENCE.md). */
  readonly notifications = signal<AppNotification[]>([]);
  readonly unreadCount = computed(() => this.notifications().filter((n) => !n.read).length);

  /**
   * The backend's own id for the signed-in account (Project.ownerId matches
   * this exactly). Null until the real /auth/me call resolves - ProjectService
   * uses it to tell "my project" apart from a teammate's without a /users
   * lookup, which the API doesn't have.
   */
  readonly userId = signal<string | null>(null);

  /**
   * /auth/me still doesn't return a role, so this is resolved the same real
   * way Settings' own isAdmin check already does - looking the signed-in
   * account up in the real tenant member list (GET /members), by id, once
   * userId is known. Null until that resolves.
   */
  readonly globalRole = signal<GlobalRole | null>(null);

  /**
   * The real 'read' role can view everything but every create/edit/train/
   * delete endpoint real-403s for it - every such control app-wide checks
   * this single flag to hide/disable itself, rather than each screen
   * re-deriving "am I read-only" its own way.
   */
  readonly isReadOnly = computed(() => this.globalRole() === 'read');

  constructor() {
    this.http.get<AuthMe>(`${environment.apiBaseUrl}/auth/me`).subscribe({
      next: (me) => {
        this.userId.set(me.userId);
        this.user.set({
          id: me.userId,
          name: me.name,
          email: me.email,
          // /auth/me doesn't return a role today, despite the backend
          // provisioning the first tenant user as an administrator - there's
          // just nowhere in this response for it to show up yet.
          role: 'analyst',
          initials: initials(me.name),
        });

        this.membersService.listMembers().subscribe({
          next: (members) => {
            const self = members.find((m) => m.id === me.userId);
            if (self) this.globalRole.set(self.globalRole);
          },
          error: (err: unknown) => console.error("Failed to load the signed-in account's role", err),
        });
      },
      error: (err: unknown) => console.error('Failed to load the signed-in account', err),
    });
  }

  markAllRead(): void {
    this.notifications.update((list) => list.map((n) => ({ ...n, read: true })));
  }
}
