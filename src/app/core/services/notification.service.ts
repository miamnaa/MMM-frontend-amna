import { Injectable, computed, signal } from '@angular/core';

import { NOTIFICATIONS, CURRENT_USER } from '../mock/mock-data';
import { AppNotification, User } from '../models/domain.models';

@Injectable({ providedIn: 'root' })
export class SessionService {
  readonly user = signal<User>(CURRENT_USER);
  readonly notifications = signal<AppNotification[]>(NOTIFICATIONS);
  readonly unreadCount = computed(() => this.notifications().filter((n) => !n.read).length);

  markAllRead(): void {
    this.notifications.update((list) => list.map((n) => ({ ...n, read: true })));
  }
}
