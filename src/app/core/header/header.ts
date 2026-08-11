import { Component, ElementRef, HostListener, inject, signal } from '@angular/core';
import { MsalService } from '@azure/msal-angular';

import { OtpService } from '../services/otp.service';
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
  private readonly otpService = inject(OtpService);
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
   *
   * Wipes localStorage/sessionStorage directly rather than trusting only
   * MsalService.instance.clearCache() - clearCache()'s own internal error
   * handling swallows failures and still resolves "successfully" even when
   * it didn't fully clear the cache (confirmed by reading msal-browser's
   * source), which was a real bug: sign-out looked like it worked but a
   * stale session survived. The theme preference is the only other thing
   * this app keeps in storage, so it's saved and restored around the wipe
   * rather than lost.
   *
   * Ends with a full page reload (window.location.href), not
   * router.navigate(). A router-only navigation leaves this tab's running
   * app - SessionService's cached user signal, the in-memory MSAL
   * instance, every singleton - untouched in memory even though storage is
   * clean. A hard reload forces the entire app to restart from zero, so
   * there is no window where anything in this tab still thinks someone is
   * signed in after this call returns.
   *
   * Tradeoff, unchanged from before: this signs out of this app only, not
   * the Microsoft/Windows-level session - a plain "Sign in with Microsoft"
   * click right after can silently re-authenticate via that still-active
   * SSO session. That's expected for an app that only signs itself out.
   */
  signOut(): void {
  this.menuOpen.set(false);
  // Otherwise a stale "verified" flag in sessionStorage could let a
  // different person on this same browser skip the email-code step.
  this.otpService.clear();

  const account = this.msalService.instance.getActiveAccount();

  this.msalService.logoutRedirect({
    account: account ?? undefined,
    postLogoutRedirectUri: `${window.location.origin}/login`,
  });
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
