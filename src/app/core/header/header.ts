import { Component, inject, signal } from '@angular/core';

import { SessionService } from '../services/notification.service';

@Component({
  selector: 'app-header',
  imports: [],
  templateUrl: './header.html',
  styleUrl: './header.css',
})
export class Header {
  private readonly session = inject(SessionService);

  readonly user = this.session.user;
  readonly notifications = this.session.notifications;
  readonly unreadCount = this.session.unreadCount;
  readonly panelOpen = signal(false);

  togglePanel(): void {
    this.panelOpen.update((open) => !open);
    if (this.panelOpen()) {
      this.session.markAllRead();
    }
  }
}
