import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';

import { environment } from '../../../environments/environment';

const VERIFIED_KEY = 'otp_verified';

/**
 * The real /auth/otp endpoints (see requirements 2026-08-11). Both require a
 * valid Entra bearer token - MsalInterceptor already attaches it to any call
 * matching apiBaseUrl/*, same as ProjectService, so no extra wiring here.
 */
@Injectable({ providedIn: 'root' })
export class OtpService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiBaseUrl}/auth/otp`;

  /**
   * localStorage, not sessionStorage - real product decision, changed
   * 2026-09-11 at explicit request: OTP used to re-ask on every new
   * browser session (tab/window closed and reopened), which read as a
   * broken/forgotten login even though it was working as originally
   * specced. Now it persists the same way the Microsoft token cache
   * already does, and only clears on an explicit sign-out (localSignOut()
   * wipes all of localStorage) - not on any fixed schedule.
   *
   * Real tradeoff worth flagging to Anas/whoever owns the MFA requirement:
   * this means anyone with access to this browser profile skips the email
   * code step indefinitely after the first real verification, not just for
   * one session. If the original OTP spec's intent was re-verification on
   * every new session specifically (a compliance requirement, not just a
   * UX default), this change may need sign-off, and a time-boxed
   * alternative (e.g. re-ask after N days) would need a real expiry
   * written alongside VERIFIED_KEY - there's no such expiry here yet.
   */
  readonly verified = signal<boolean>(localStorage.getItem(VERIFIED_KEY) === 'true');

  readonly requesting = signal(false);
  readonly verifying = signal(false);
  readonly requestError = signal<string | null>(null);
  readonly verifyError = signal<string | null>(null);
  /** Set once a request call actually succeeds, so the screen can say "code sent". */
  readonly codeSent = signal(false);

  requestCode(): void {
    if (this.requesting()) return;
    this.requesting.set(true);
    this.requestError.set(null);

    this.http.post<void>(`${this.url}/request`, {}).subscribe({
      next: () => {
        this.requesting.set(false);
        this.codeSent.set(true);
      },
      error: (err: unknown) => {
        this.requesting.set(false);
        this.codeSent.set(false);
        this.requestError.set(this.requestErrorMessage(err));
      },
    });
  }

  verifyCode(code: string): void {
    if (this.verifying()) return;
    this.verifying.set(true);
    this.verifyError.set(null);

    this.http.post<void>(`${this.url}/verify`, { code }).subscribe({
      next: () => {
        this.verifying.set(false);
        this.verified.set(true);
        localStorage.setItem(VERIFIED_KEY, 'true');
      },
      error: (err: unknown) => {
        this.verifying.set(false);
        this.verifyError.set(this.verifyErrorMessage(err));
      },
    });
  }

  clear(): void {
    this.verified.set(false);
    this.codeSent.set(false);
    this.requestError.set(null);
    this.verifyError.set(null);
    localStorage.removeItem(VERIFIED_KEY);
  }

  /**
   * Sending mail depends on a Microsoft Graph permission grant that's
   * pending as of 2026-08-11 - a 500 here is a known, expected state until
   * that's granted, not a bug, so it gets its own message rather than
   * reading as a generic failure.
   */
  private requestErrorMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse && err.status === 500) {
      return "Couldn't send the code right now — email delivery isn't fully set up yet. Try again shortly.";
    }
    return this.backendMessage(err, 'Could not send a verification code. Try again.');
  }

  private verifyErrorMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 404) return 'No code was requested yet. Tap "Resend code" and try again.';
      if (err.status === 401) return this.backendMessage(err, "That code didn't work — it may be wrong, expired, or you've tried too many times.");
    }
    return this.backendMessage(err, 'Could not verify that code. Try again.');
  }

  /** Same "message" shape as the rest of the API (API-REFERENCE.md, "Response conventions"). */
  private backendMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      const message: unknown = err.error?.message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join(' ');
    }
    return fallback;
  }
}
