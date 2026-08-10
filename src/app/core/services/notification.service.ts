import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';

import { environment } from '../../../environments/environment';
import { initials } from '../../shared/utils/format';
import { NOTIFICATIONS, CURRENT_USER } from '../mock/mock-data';
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

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly http = inject(HttpClient);

  readonly user = signal<User>(CURRENT_USER);
  readonly notifications = signal<AppNotification[]>(NOTIFICATIONS);
  readonly unreadCount = computed(() => this.notifications().filter((n) => !n.read).length);

  /**
   * The backend's own id for the signed-in account (Project.ownerId matches
   * this exactly). Null until the real /auth/me call resolves, or always
   * null in mock mode - ProjectService uses it to tell "my project" apart
   * from a teammate's without a /users lookup, which the API doesn't have.
   */
  readonly userId = signal<string | null>(null);

  constructor() {
    if (environment.mock.auth) return;

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
