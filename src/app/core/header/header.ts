import { Component, ElementRef, HostListener, inject, input, signal } from '@angular/core';
import { MsalService } from '@azure/msal-angular';

import { localSignOut } from '../auth/local-sign-out';
import { SessionService } from '../services/notification.service';
import { ThemeService } from '../services/theme.service';

@Component({
  selector: 'app-header',
  imports: [],
  templateUrl: './header.html',
  styleUrl: './header.css',
})
export class Header {
  private readonly session = inject(SessionService);
  private readonly themeService = inject(ThemeService);
  private readonly msalService = inject(MsalService);
  private readonly host = inject(ElementRef<HTMLElement>);

  /** Settings has nothing to search (no projects/datasets/experiments there) - set via route data, see MainLayout. */
  readonly hideSearch = input(false);

  readonly user = this.session.user;
  readonly notifications = this.session.notifications;
  readonly unreadCount = this.session.unreadCount;
  readonly theme = this.themeService.theme;

  readonly panelOpen = signal(false);
  readonly menuOpen = signal(false);

  togglePanel(): void {
    this.menuOpen.set(false);
    this.panelOpen.update((open) => !open);
    if (this.panelOpen()) {
      this.session.markAllRead();
    }
  }

  toggleMenu(): void {
    this.panelOpen.set(false);
    this.menuOpen.update((open) => !open);
  }

  toggleTheme(): void {
    this.themeService.toggle();
  }

  /** See local-sign-out.ts for why this isn't logoutRedirect()/logoutPopup(). */
  signOut(): void {
    this.menuOpen.set(false);
    void localSignOut(this.msalService);
  }
  /** Both overlays are dismissible the way users expect. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.panelOpen.set(false);
      this.menuOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.panelOpen.set(false);
    this.menuOpen.set(false);
  }
}
