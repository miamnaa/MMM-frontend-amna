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

  /**
   * Real field from POST /auth/otp/verify's 401 body as of 2026-09-11 -
   * null until a wrong-code response actually reports it (never guessed at
   * client-side, since only the backend knows the real count). 0 means the
   * real 5-attempt limit was just hit on this code - Verify should stop
   * accepting guesses until a fresh code is requested. Reset to null on
   * every successful request-code call, since a new code gets a clean
   * attempt count server-side.
   */
  readonly attemptsRemaining = signal<number | null>(null);
  readonly lockedOut = signal(false);

  /**
   * Real 10-minute code lifetime (confirmed by backend, 2026-09-11) - not
   * read from any response field, just the known real duration, timed from
   * the moment a request actually succeeds. Null until then, and reset on
   * every new request so a resend restarts the real window instead of
   * counting down from the old code's expiry.
   */
  readonly codeExpiresAt = signal<number | null>(null);

  requestCode(): void {
    if (this.requesting()) return;
    this.requesting.set(true);
    this.requestError.set(null);
    this.attemptsRemaining.set(null);
    this.lockedOut.set(false);

    this.http.post<void>(`${this.url}/request`, {}).subscribe({
      next: () => {
        this.requesting.set(false);
        this.codeSent.set(true);
        this.codeExpiresAt.set(Date.now() + 10 * 60 * 1000);
      },
      error: (err: unknown) => {
        this.requesting.set(false);
        this.codeSent.set(false);
        this.codeExpiresAt.set(null);
        this.requestError.set(this.requestErrorMessage(err));
      },
    });
  }

  verifyCode(code: string): void {
    if (this.verifying() || this.lockedOut()) return;
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
        const remaining = this.attemptsRemainingFrom(err);
        this.attemptsRemaining.set(remaining);
        if (remaining === 0) this.lockedOut.set(true);
        this.verifyError.set(this.verifyErrorMessage(err, remaining));
      },
    });
  }

  clear(): void {
    this.verified.set(false);
    this.codeSent.set(false);
    this.requestError.set(null);
    this.verifyError.set(null);
    this.attemptsRemaining.set(null);
    this.lockedOut.set(false);
    this.codeExpiresAt.set(null);
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

  /** Real field, not guessed - undefined/non-numeric (an older backend response, or a non-401 error) just means "don't show a count," not "0 left." */
  private attemptsRemainingFrom(err: unknown): number | null {
    if (err instanceof HttpErrorResponse) {
      const remaining: unknown = err.error?.attemptsRemaining;
      if (typeof remaining === 'number' && Number.isFinite(remaining)) return remaining;
    }
    return null;
  }

  private verifyErrorMessage(err: unknown, remaining: number | null): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 404) return 'No code was requested yet. Tap "Resend code" and try again.';
      if (err.status === 401) {
        const message = this.backendMessage(err, "That code didn't work — it may be wrong, expired, or you've tried too many times.");
        // remaining === 0 already reads as a real limit-hit message from the
        // backend ("Too many incorrect attempts...") - appending a count
        // there would be redundant, not additive.
        if (remaining !== null && remaining > 0) {
          return `${message} ${remaining} attempt${remaining === 1 ? '' : 's'} left.`;
        }
        return message;
      }
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
