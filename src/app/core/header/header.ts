import { Component, ElementRef, HostListener, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
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
  private readonly router = inject(Router);
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

  /**
   * Local sign-out, not logoutRedirect(). logoutRedirect() hits Microsoft's
   * own end-session endpoint, which - for an account "Connected to
   * Windows" (device-level SSO) - shows its own account-picker
   * confirmation no matter what request options are passed; that's
   * Microsoft's platform behaviour, not something this app can override.
   * clearCache() only clears MSAL's local browser storage, so it never
   * navigates anywhere - this app forgets the session and sends the user
   * to /login itself, with zero Microsoft page in between. The tradeoff:
   * this doesn't end the Microsoft/Windows-level session itself, only this
   * app's - a plain "Sign in with Microsoft" click right after can silently
   * re-authenticate via that still-active SSO session, which is standard
   * for apps that only need to sign out of themselves.
   */
  signOut(): void {
    this.menuOpen.set(false);
    const account = this.msalService.instance.getActiveAccount();
    this.msalService.instance
      .clearCache({ account })
      .then(() => {
        this.msalService.instance.setActiveAccount(null);
        this.router.navigate(['/login']);
      })
      .catch((err: unknown) => console.error('Sign-out failed', err));
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
