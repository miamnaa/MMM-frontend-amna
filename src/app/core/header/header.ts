import { Component, ElementRef, HostListener, inject, signal } from '@angular/core';
import { MsalService } from '@azure/msal-angular';

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

  signOut(): void {
    this.menuOpen.set(false);
    // logoutRedirect navigates the browser away on success, landing on
    // postLogoutRedirectUri (/login) - same COOP reasoning as sign-in, a
    // logout popup would hit the identical window.opener failure.
    // Passing the active account + logoutHint tells Microsoft's own logout
    // page exactly which session to end, so it skips its "pick an account"
    // prompt instead of asking - without this it can't tell which of
    // possibly several signed-in accounts on the device we mean.
    const account = this.msalService.instance.getActiveAccount();
    this.msalService
      .logoutRedirect({ account, logoutHint: account?.username })
      .subscribe({ error: (err: unknown) => console.error('Sign-out failed', err) });
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
