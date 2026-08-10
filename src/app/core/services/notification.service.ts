import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';

import { environment } from '../../../environments/environment';
import { initials } from '../../shared/utils/format';
import { AppNotification, User } from '../models/domain.models';

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
      },
      error: (err: unknown) => console.error('Failed to load the signed-in account', err),
    });
  }

  markAllRead(): void {
    this.notifications.update((list) => list.map((n) => ({ ...n, read: true })));
  }
}
